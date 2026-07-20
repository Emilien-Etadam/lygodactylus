/**
 * Careful-mode gate on write/edit ToolDefinitions (same hook point as checkpoints).
 * Suspends execution and asks via the existing permission IPC with a unified diff.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { PermissionDiffPayload, PermissionResult } from '../../renderer/types';
import { normalizeSessionAutonomy, type SessionAutonomy } from '../../shared/session-autonomy';
import { log, logWarn } from '../utils/logger';
import { clearCarefulAllowRun, hasCarefulAllowRun, rememberCarefulAllowRun } from './careful-run-allow';
import { createUnifiedDiff } from './unified-diff';

export type CarefulRequestPermission = (
  sessionId: string,
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown>,
  options?: { diff?: PermissionDiffPayload; allowRunOption?: boolean }
) => Promise<PermissionResult>;

type ToolExecute = ToolDefinition['execute'];

interface EditPair {
  oldText: string;
  newText: string;
}

function extractPathFromParams(params: unknown): string | null {
  if (!params || typeof params !== 'object') {
    return null;
  }
  const record = params as Record<string, unknown>;
  if (typeof record.path === 'string' && record.path.trim()) {
    return record.path.trim();
  }
  if (typeof record.file_path === 'string' && record.file_path.trim()) {
    return record.file_path.trim();
  }
  return null;
}

function extractWriteContent(params: unknown): string | null {
  if (!params || typeof params !== 'object') {
    return null;
  }
  const record = params as Record<string, unknown>;
  if (typeof record.content === 'string') {
    return record.content;
  }
  if (typeof record.contents === 'string') {
    return record.contents;
  }
  return null;
}

function extractEdits(params: unknown): EditPair[] {
  if (!params || typeof params !== 'object') {
    return [];
  }
  const record = params as Record<string, unknown>;
  const edits: EditPair[] = [];
  if (Array.isArray(record.edits)) {
    for (const item of record.edits) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const edit = item as Record<string, unknown>;
      const oldText =
        typeof edit.oldText === 'string'
          ? edit.oldText
          : typeof edit.old_string === 'string'
            ? edit.old_string
            : null;
      const newText =
        typeof edit.newText === 'string'
          ? edit.newText
          : typeof edit.new_string === 'string'
            ? edit.new_string
            : null;
      if (oldText !== null && newText !== null) {
        edits.push({ oldText, newText });
      }
    }
  }
  // Legacy single-edit shape
  const legacyOld =
    typeof record.oldText === 'string'
      ? record.oldText
      : typeof record.old_string === 'string'
        ? record.old_string
        : null;
  const legacyNew =
    typeof record.newText === 'string'
      ? record.newText
      : typeof record.new_string === 'string'
        ? record.new_string
        : null;
  if (legacyOld !== null && legacyNew !== null) {
    edits.push({ oldText: legacyOld, newText: legacyNew });
  }
  return edits;
}

function applyEditsExact(content: string, edits: EditPair[]): string | null {
  let next = content;
  for (const edit of edits) {
    const index = next.indexOf(edit.oldText);
    if (index < 0) {
      return null;
    }
    // Ambiguous: more than one match — still produce a best-effort preview
    // by replacing the first occurrence only (matches typical edit tools).
    next = next.slice(0, index) + edit.newText + next.slice(index + edit.oldText.length);
  }
  return next;
}

function readFileUtf8(absolutePath: string): { exists: boolean; content: string } {
  try {
    if (!fs.existsSync(absolutePath)) {
      return { exists: false, content: '' };
    }
    return { exists: true, content: fs.readFileSync(absolutePath, 'utf8') };
  } catch {
    return { exists: false, content: '' };
  }
}

function resolveAbsolutePath(workspaceRoot: string, relativeOrAbsolute: string): string {
  if (path.isAbsolute(relativeOrAbsolute)) {
    return path.normalize(relativeOrAbsolute);
  }
  return path.normalize(path.join(workspaceRoot, relativeOrAbsolute));
}

function displayPath(workspaceRoot: string, absolutePath: string): string {
  const rel = path.relative(workspaceRoot, absolutePath);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel.split(path.sep).join('/');
  }
  return absolutePath;
}

function buildDiffPayload(
  toolName: 'write' | 'edit',
  workspaceRoot: string,
  params: unknown
): PermissionDiffPayload | null {
  const relativeOrAbsolute = extractPathFromParams(params);
  if (!relativeOrAbsolute) {
    return null;
  }
  const absolutePath = resolveAbsolutePath(workspaceRoot, relativeOrAbsolute);
  const shownPath = displayPath(workspaceRoot, absolutePath);
  const { exists, content: oldContent } = readFileUtf8(absolutePath);

  let newContent: string | null = null;
  if (toolName === 'write') {
    newContent = extractWriteContent(params);
  } else {
    const edits = extractEdits(params);
    if (edits.length === 0) {
      newContent = null;
    } else if (!exists) {
      // Preview as concatenation of newTexts when file missing
      newContent = edits.map((e) => e.newText).join('');
    } else {
      newContent = applyEditsExact(oldContent, edits);
    }
  }

  if (newContent === null) {
    // Fallback without full diff: filename + change size estimate
    const approxBytes =
      toolName === 'write'
        ? Buffer.byteLength(extractWriteContent(params) ?? '', 'utf8')
        : extractEdits(params).reduce(
            (sum, e) => sum + Buffer.byteLength(e.newText, 'utf8'),
            0
          );
    return {
      path: shownPath,
      oldContent: exists ? oldContent : undefined,
      newContent: '',
      unifiedDiff: `--- a/${shownPath}\n+++ b/${shownPath}\n@@ (preview unavailable) @@\n# change ≈ ${approxBytes} bytes`,
      changeBytes: approxBytes,
      isNewFile: !exists,
    };
  }

  const unifiedDiff = createUnifiedDiff(shownPath, exists ? oldContent : '', newContent);
  const changeBytes = Math.abs(
    Buffer.byteLength(newContent, 'utf8') - Buffer.byteLength(exists ? oldContent : '', 'utf8')
  );
  return {
    path: shownPath,
    oldContent: exists ? oldContent : undefined,
    newContent,
    unifiedDiff,
    changeBytes,
    isNewFile: !exists,
  };
}

function denialResult(reason: string) {
  return {
    content: [{ type: 'text' as const, text: reason }],
    details: undefined,
  };
}

function wrapExecute(
  toolName: 'write' | 'edit',
  originalExecute: ToolExecute,
  sessionId: string,
  workspaceRoot: string,
  getAutonomy: () => SessionAutonomy,
  requestPermission: CarefulRequestPermission
): ToolExecute {
  return async (toolCallId, params, signal, onUpdate, ctx) => {
    const autonomy = normalizeSessionAutonomy(getAutonomy());
    if (autonomy !== 'careful') {
      return originalExecute(toolCallId, params, signal, onUpdate, ctx);
    }

    if (hasCarefulAllowRun(sessionId)) {
      return originalExecute(toolCallId, params, signal, onUpdate, ctx);
    }

    const input =
      params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
    const diff = buildDiffPayload(toolName, workspaceRoot, params);
    const toolUseId = `${toolCallId || 'unknown'}-careful-${uuidv4().slice(0, 8)}`;

    let result: PermissionResult;
    try {
      result = await requestPermission(sessionId, toolUseId, toolName, input, {
        diff: diff ?? undefined,
        allowRunOption: true,
      });
    } catch (error) {
      logWarn(`[Careful] Permission request failed for ${toolName}:`, error);
      return denialResult(
        `Careful mode: permission request failed for '${toolName}'; file was not modified.`
      );
    }

    if (result === 'deny') {
      const fileHint = diff?.path ? ` (${diff.path})` : '';
      log(`[Careful] User denied ${toolName}${fileHint}`);
      return denialResult(
        `User denied this ${toolName}${fileHint} in careful mode. Adjust the change or ask the user before retrying.`
      );
    }

    if (result === 'allow_run' || result === 'allow_always') {
      // allow_always in careful context is treated as run-scoped approve-all
      // (session-wide always-allow for write/edit is too broad for careful).
      rememberCarefulAllowRun(sessionId);
    }

    return originalExecute(toolCallId, params, signal, onUpdate, ctx);
  };
}

/**
 * Wrap write/edit tools for careful-mode diff approval.
 * Other tools are returned unchanged. No-op when getAutonomy is never 'careful'.
 */
export function wrapFileMutationToolsForCareful(
  tools: ToolDefinition[],
  sessionId: string,
  workspaceRoot: string,
  getAutonomy: () => SessionAutonomy,
  requestPermission: CarefulRequestPermission | undefined
): ToolDefinition[] {
  if (!requestPermission) {
    return tools;
  }
  const root = path.normalize(workspaceRoot);
  return tools.map((tool) => {
    if (tool.name !== 'write' && tool.name !== 'edit') {
      return tool;
    }
    return {
      ...tool,
      execute: wrapExecute(
        tool.name,
        tool.execute,
        sessionId,
        root,
        getAutonomy,
        requestPermission
      ),
    } as ToolDefinition;
  });
}

export { clearCarefulAllowRun };
