/**
 * Per-workspace lint/test commands for autonomous mode.
 * Stored in AppConfig.workspaceTooling keyed by normalized workspace path.
 */
import * as path from 'node:path';
import { configStore } from '../config/config-store';

export interface WorkspaceToolingCommands {
  lintCmd?: string;
  testCmd?: string;
}

export function normalizeWorkspaceToolingKey(cwd: string): string {
  return path.normalize(cwd.trim());
}

export function getWorkspaceTooling(cwd: string | undefined): WorkspaceToolingCommands {
  if (!cwd || !cwd.trim()) {
    return {};
  }
  const key = normalizeWorkspaceToolingKey(cwd);
  const all = configStore.get('workspaceTooling') ?? {};
  const entry = all[key];
  if (!entry || typeof entry !== 'object') {
    return {};
  }
  const lintCmd =
    typeof entry.lintCmd === 'string' && entry.lintCmd.trim() ? entry.lintCmd.trim() : undefined;
  const testCmd =
    typeof entry.testCmd === 'string' && entry.testCmd.trim() ? entry.testCmd.trim() : undefined;
  return { lintCmd, testCmd };
}

export function setWorkspaceTooling(
  cwd: string,
  commands: WorkspaceToolingCommands
): WorkspaceToolingCommands {
  const key = normalizeWorkspaceToolingKey(cwd);
  const all = { ...(configStore.get('workspaceTooling') ?? {}) };
  const lintCmd =
    typeof commands.lintCmd === 'string' && commands.lintCmd.trim()
      ? commands.lintCmd.trim()
      : undefined;
  const testCmd =
    typeof commands.testCmd === 'string' && commands.testCmd.trim()
      ? commands.testCmd.trim()
      : undefined;

  if (!lintCmd && !testCmd) {
    delete all[key];
  } else {
    all[key] = { lintCmd, testCmd };
  }
  configStore.set('workspaceTooling', all);
  return { lintCmd, testCmd };
}

export function listConfiguredCommands(commands: WorkspaceToolingCommands): Array<{
  kind: 'lint' | 'test';
  command: string;
}> {
  const out: Array<{ kind: 'lint' | 'test'; command: string }> = [];
  if (commands.lintCmd) {
    out.push({ kind: 'lint', command: commands.lintCmd });
  }
  if (commands.testCmd) {
    out.push({ kind: 'test', command: commands.testCmd });
  }
  return out;
}
