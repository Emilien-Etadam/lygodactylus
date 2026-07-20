import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { MemoryRerankerConfig } from '../config/config-schema';
import { hashWorkspaceKey, cosineSimilarity } from '../memory/memory-utils';
import { maybeRerankMemoryItems } from '../memory/memory-reranker-client';
import { log, logWarn } from '../utils/logger';
import { chunkTextByLines, excerptFromChunkText } from './chunker';
import {
  SEMANTIC_ALWAYS_IGNORE_DIR_NAMES,
  SEMANTIC_DEFAULT_TOP_K,
  SEMANTIC_MAX_TOP_K,
  SEMANTIC_WATCH_DEBOUNCE_MS,
} from './constants';
import { isAllowedTextFile, isWithinFileSizeLimit } from './file-filters';
import { isIgnoredByGitignore, listIndexableWorkspaceFiles } from './gitignore';
import { ensureSemanticIndexDir, SemanticIndexStore, semanticIndexDbPath } from './index-store';
import { resolveContainedWorkspacePath, toWorkspaceRelativePath } from './path-safety';

export interface SemanticSearchHit {
  file: string;
  line: number;
  excerpt: string;
  score: number;
}

export interface SemanticIndexServiceOptions {
  storageRoot: string;
  embed: (text: string) => Promise<number[]>;
  getRerankerConfig: () => MemoryRerankerConfig;
  debounceMs?: number;
  /** Injected for tests (skip chokidar). */
  enableWatcher?: boolean;
}

interface WorkspaceState {
  workspaceRoot: string;
  store: SemanticIndexStore;
  ready: boolean;
  building: Promise<void> | null;
  watcher: FSWatcher | null;
  pending: Map<string, ReturnType<typeof setTimeout>>;
}

/**
 * Lazy + incremental semantic index over a workspace's text files.
 */
export class SemanticIndexService {
  private readonly workspaces = new Map<string, WorkspaceState>();
  private readonly debounceMs: number;
  private readonly enableWatcher: boolean;

  constructor(private readonly options: SemanticIndexServiceOptions) {
    this.debounceMs = options.debounceMs ?? SEMANTIC_WATCH_DEBOUNCE_MS;
    this.enableWatcher = options.enableWatcher !== false;
    ensureSemanticIndexDir(options.storageRoot);
  }

  async search(
    workspaceRoot: string,
    query: string,
    topK = SEMANTIC_DEFAULT_TOP_K
  ): Promise<SemanticSearchHit[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const root = resolveContainedWorkspacePath(workspaceRoot, workspaceRoot);
    if (!root) {
      return [];
    }

    const limit = Math.max(1, Math.min(SEMANTIC_MAX_TOP_K, Math.round(topK)));
    await this.ensureIndex(root);

    const queryEmbedding = await this.options.embed(trimmed);
    if (!queryEmbedding.length) {
      logWarn('[SemanticSearch] Query embedding empty; returning no hits');
      return [];
    }

    const state = this.getOrCreateState(root);
    const chunks = state.store.getAllChunks();
    const scored = chunks
      .map((chunk) => ({
        file: chunk.relPath,
        line: chunk.startLine,
        excerpt: chunk.excerpt,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
        documentText: `${chunk.relPath}:${chunk.startLine}\n${chunk.excerpt}`,
      }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);

    const reranker = this.options.getRerankerConfig();
    const reranked = await maybeRerankMemoryItems({
      enabled: reranker.enabled,
      config: reranker,
      query: trimmed,
      items: scored.slice(0, Math.max(limit, reranker.topN)),
      logLabel: 'semantic_search',
    });

    return reranked.slice(0, limit).map(({ file, line, excerpt, score }) => ({
      file,
      line,
      excerpt,
      score,
    }));
  }

  /** Test helper: force re-index of a single relative file. */
  async reindexFileForTests(workspaceRoot: string, relativePath: string): Promise<void> {
    const root = resolveContainedWorkspacePath(workspaceRoot, workspaceRoot);
    if (!root) {
      throw new Error('Invalid workspace root');
    }
    await this.ensureIndex(root);
    await this.indexRelativeFile(root, relativePath);
  }

  /** Test helper: read stored chunk count for a file. */
  getStoredChunkCountForTests(workspaceRoot: string, relativePath: string): number {
    const root = resolveContainedWorkspacePath(workspaceRoot, workspaceRoot);
    if (!root) {
      return 0;
    }
    const state = this.workspaces.get(hashWorkspaceKey(root));
    if (!state) {
      return 0;
    }
    return state.store.getAllChunks().filter((chunk) => chunk.relPath === relativePath).length;
  }

  /** Test helper: read stored excerpts for a file (order by start line). */
  getStoredExcerptsForTests(workspaceRoot: string, relativePath: string): string[] {
    const root = resolveContainedWorkspacePath(workspaceRoot, workspaceRoot);
    if (!root) {
      return [];
    }
    const state = this.workspaces.get(hashWorkspaceKey(root));
    if (!state) {
      return [];
    }
    return state.store
      .getAllChunks()
      .filter((chunk) => chunk.relPath === relativePath)
      .sort((a, b) => a.startLine - b.startLine)
      .map((chunk) => chunk.excerpt);
  }

  close(): void {
    for (const state of this.workspaces.values()) {
      this.stopWatcher(state);
      state.store.close();
    }
    this.workspaces.clear();
  }

  private getOrCreateState(workspaceRoot: string): WorkspaceState {
    const key = hashWorkspaceKey(workspaceRoot);
    let state = this.workspaces.get(key);
    if (!state) {
      const dbPath = semanticIndexDbPath(this.options.storageRoot, key);
      state = {
        workspaceRoot,
        store: new SemanticIndexStore(dbPath),
        ready: false,
        building: null,
        watcher: null,
        pending: new Map(),
      };
      this.workspaces.set(key, state);
    }
    return state;
  }

  private async ensureIndex(workspaceRoot: string): Promise<void> {
    const state = this.getOrCreateState(workspaceRoot);
    if (state.ready) {
      return;
    }
    if (state.building) {
      await state.building;
      return;
    }

    state.building = this.buildFullIndex(state).finally(() => {
      state.building = null;
    });
    await state.building;
  }

  private async buildFullIndex(state: WorkspaceState): Promise<void> {
    const root = state.workspaceRoot;
    log(`[SemanticSearch] Building index for workspace ${root}`);
    const files = await listIndexableWorkspaceFiles(root);
    let indexed = 0;
    for (const relative of files) {
      await this.indexRelativeFile(root, relative);
      indexed += 1;
      if (indexed === 1 || indexed % 50 === 0 || indexed === files.length) {
        log(`[SemanticSearch] Indexed ${indexed}/${files.length} files`);
      }
    }

    // Drop stale files no longer present / no longer allowed.
    const live = new Set(files);
    for (const stored of state.store.listFilePaths()) {
      if (!live.has(stored)) {
        state.store.removeFile(stored);
      }
    }

    state.ready = true;
    log(`[SemanticSearch] Index ready (${files.length} files)`);
    this.startWatcher(state);
  }

  private async indexRelativeFile(workspaceRoot: string, relativePath: string): Promise<void> {
    const state = this.getOrCreateState(workspaceRoot);
    const posixRel = relativePath.split(path.sep).join('/');

    if (
      !posixRel ||
      !isAllowedTextFile(posixRel) ||
      isIgnoredByGitignore(workspaceRoot, posixRel)
    ) {
      state.store.removeFile(posixRel);
      return;
    }

    const absolute = resolveContainedWorkspacePath(workspaceRoot, posixRel);
    if (!absolute) {
      state.store.removeFile(posixRel);
      return;
    }

    let content: string;
    let mtimeMs: number;
    let sizeBytes: number;
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || !isWithinFileSizeLimit(stat.size)) {
        state.store.removeFile(posixRel);
        return;
      }
      mtimeMs = stat.mtimeMs;
      sizeBytes = stat.size;
      content = fs.readFileSync(absolute, 'utf8');
    } catch {
      state.store.removeFile(posixRel);
      return;
    }

    const contentHash = crypto.createHash('sha1').update(content).digest('hex');
    const existing = state.store.getFileMeta(posixRel);
    if (
      existing &&
      existing.contentHash === contentHash &&
      existing.mtimeMs === mtimeMs &&
      existing.sizeBytes === sizeBytes
    ) {
      return;
    }

    const textChunks = chunkTextByLines(content);
    const embedded: Array<{
      startLine: number;
      endLine: number;
      excerpt: string;
      embedding: number[];
    }> = [];

    for (const chunk of textChunks) {
      const embedding = await this.options.embed(chunk.text);
      if (!embedding.length) {
        continue;
      }
      embedded.push({
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        excerpt: excerptFromChunkText(chunk.text),
        embedding,
      });
    }

    state.store.replaceFileChunks({ relPath: posixRel, mtimeMs, sizeBytes, contentHash }, embedded);
  }

  private startWatcher(state: WorkspaceState): void {
    if (!this.enableWatcher || state.watcher) {
      return;
    }

    const ignoredNames = SEMANTIC_ALWAYS_IGNORE_DIR_NAMES;
    try {
      state.watcher = chokidar.watch(state.workspaceRoot, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 100,
        },
        ignored: (watchPath: string) => {
          const segments = watchPath.split(path.sep);
          return segments.some((segment) => ignoredNames.has(segment));
        },
      });

      const schedule = (absPath: string): void => {
        const relative = toWorkspaceRelativePath(state.workspaceRoot, absPath);
        if (!relative) {
          return;
        }
        const existing = state.pending.get(relative);
        if (existing) {
          clearTimeout(existing);
        }
        const timer = setTimeout(() => {
          state.pending.delete(relative);
          void this.indexRelativeFile(state.workspaceRoot, relative).catch((error: unknown) => {
            logWarn('[SemanticSearch] Incremental re-index failed:', error);
          });
        }, this.debounceMs);
        timer.unref?.();
        state.pending.set(relative, timer);
      };

      state.watcher.on('add', schedule);
      state.watcher.on('change', schedule);
      state.watcher.on('unlink', (absPath: string) => {
        const relative =
          toWorkspaceRelativePath(state.workspaceRoot, absPath) ??
          relativeFromRootIfContained(state.workspaceRoot, absPath);
        if (!relative) {
          return;
        }
        const pending = state.pending.get(relative);
        if (pending) {
          clearTimeout(pending);
          state.pending.delete(relative);
        }
        state.store.removeFile(relative);
      });
      state.watcher.on('error', (error: unknown) => {
        logWarn('[SemanticSearch] Watcher error:', error);
      });
    } catch (error) {
      logWarn('[SemanticSearch] Failed to start watcher:', error);
    }
  }

  private stopWatcher(state: WorkspaceState): void {
    for (const timer of state.pending.values()) {
      clearTimeout(timer);
    }
    state.pending.clear();
    if (state.watcher) {
      void state.watcher.close();
      state.watcher = null;
    }
  }
}

function relativeFromRootIfContained(workspaceRoot: string, absolutePath: string): string | null {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(absolutePath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(path.sep).join('/');
}
