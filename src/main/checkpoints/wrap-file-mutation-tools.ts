/**
 * Wrap pi write/edit ToolDefinitions so pre-images are captured before FS mutation.
 * Provided as customTools (same pattern as bash) — they override built-ins.
 */
import * as path from 'node:path';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { checkpointService } from './checkpoint-service';
import type { CheckpointCaptureSource } from './types';

type ToolExecute = ToolDefinition['execute'];

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

function wrapExecute(
  toolName: 'write' | 'edit',
  originalExecute: ToolExecute,
  sessionId: string,
  workspaceRoot: string
): ToolExecute {
  const source: CheckpointCaptureSource = toolName;
  return async (toolCallId, params, signal, onUpdate, ctx) => {
    const relativeOrAbsolute = extractPathFromParams(params);
    if (relativeOrAbsolute) {
      const absolutePath = checkpointService.resolveWorkspacePath(
        workspaceRoot,
        relativeOrAbsolute
      );
      checkpointService.capturePath(sessionId, absolutePath, source);
    }
    return originalExecute(toolCallId, params, signal, onUpdate, ctx);
  };
}

/**
 * Wrap write/edit tools for checkpoint capture. Other tools are returned unchanged.
 */
export function wrapFileMutationToolsForCheckpoints(
  tools: ToolDefinition[],
  sessionId: string,
  workspaceRoot: string
): ToolDefinition[] {
  const root = path.normalize(workspaceRoot);
  return tools.map((tool) => {
    if (tool.name !== 'write' && tool.name !== 'edit') {
      return tool;
    }
    return {
      ...tool,
      execute: wrapExecute(tool.name, tool.execute, sessionId, root),
    } as ToolDefinition;
  });
}
