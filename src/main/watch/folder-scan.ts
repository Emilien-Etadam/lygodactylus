/**
 * One-shot folder snapshot via chokidar (no permanent watcher).
 */
import chokidar from 'chokidar';
import * as fs from 'node:fs';
import * as path from 'node:path';

const IGNORED_BASENAMES = new Set([
  '.git',
  'node_modules',
  '.DS_Store',
  'Thumbs.db',
  '.lygodactylus',
]);

export interface FolderSnapshot {
  files: Record<string, number>;
}

export interface FolderChangeSet {
  added: string[];
  modified: string[];
  deleted: string[];
}

export function hasFolderChanges(changes: FolderChangeSet): boolean {
  return changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0;
}

export function diffFolderSnapshots(
  previous: Record<string, number>,
  current: Record<string, number>
): FolderChangeSet {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [filePath, mtime] of Object.entries(current)) {
    const prev = previous[filePath];
    if (prev === undefined) {
      added.push(filePath);
    } else if (prev !== mtime) {
      modified.push(filePath);
    }
  }
  for (const filePath of Object.keys(previous)) {
    if (current[filePath] === undefined) {
      deleted.push(filePath);
    }
  }

  added.sort();
  modified.sort();
  deleted.sort();
  return { added, modified, deleted };
}

function shouldIgnore(watchedPath: string): boolean {
  const parts = watchedPath.split(/[/\\]/);
  return parts.some((part) => IGNORED_BASENAMES.has(part));
}

/**
 * Scan a folder once with chokidar, then close the watcher.
 * Inject `watchFn` in tests.
 */
export async function scanFolderSnapshot(
  folderPath: string,
  options: { watchFn?: typeof chokidar.watch; timeoutMs?: number } = {}
): Promise<FolderSnapshot> {
  const root = path.resolve(folderPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Folder does not exist or is not a directory: ${root}`);
  }

  const watch = options.watchFn ?? chokidar.watch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const files: Record<string, number> = {};

  return new Promise<FolderSnapshot>((resolve, reject) => {
    let settled = false;
    let watcher: ReturnType<typeof watch> | null = null;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const closePromise = watcher ? watcher.close() : Promise.resolve();
      void closePromise.finally(() => {
        if (error) {
          reject(error);
        } else {
          resolve({ files });
        }
      });
    };

    const timer = setTimeout(() => {
      finish(new Error(`Folder scan timed out after ${timeoutMs}ms: ${root}`));
    }, timeoutMs);

    try {
      watcher = watch(root, {
        persistent: true,
        ignoreInitial: false,
        ignored: shouldIgnore,
        depth: 12,
        awaitWriteFinish: false,
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const recordPath = (eventPath: string): void => {
      try {
        const normalized = path.normalize(eventPath);
        if (shouldIgnore(normalized)) return;
        const stat = fs.statSync(normalized);
        if (stat.isFile()) {
          files[normalized] = stat.mtimeMs;
        }
      } catch {
        // File may have disappeared between event and stat — ignore.
      }
    };

    watcher.on('add', recordPath);
    watcher.on('change', recordPath);
    watcher.on('ready', () => {
      finish();
    });
    watcher.on('error', (error: unknown) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
  });
}
