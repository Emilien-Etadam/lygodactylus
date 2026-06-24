/**
 * @module main/main-working-dir
 *
 * Global default working directory and per-session cwd updates.
 */
import { app } from 'electron';
import { join } from 'path';
import * as fs from 'fs';
import { configStore } from './config/config-store';
import { SandboxSync } from './sandbox/sandbox-sync';
import { getSandboxBootstrap } from './sandbox/sandbox-bootstrap';
import { getUnsupportedWorkspacePathReason } from './workspace-path-constraints';
import { log, logError } from './utils/logger';
import { mainAppState } from './main-app-state';
import { sendToRenderer } from './main-renderer-bridge';

export function initializeDefaultWorkingDir(): string {
  const userDataPath = app.getPath('userData');
  const defaultDir = join(userDataPath, 'default_working_dir');

  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
    log('[App] Created default working directory:', defaultDir);
  }

  mainAppState.currentWorkingDir = defaultDir;

  log('[App] Global default working directory:', mainAppState.currentWorkingDir);
  return mainAppState.currentWorkingDir;
}

export function getWorkingDir(): string | null {
  return mainAppState.currentWorkingDir;
}

export function getWorkspacePathUnsupportedReason(workspacePath?: string): string | null {
  return getUnsupportedWorkspacePathReason({
    platform: process.platform,
    sandboxEnabled: configStore.get('sandboxEnabled') !== false,
    workspacePath,
  });
}

export async function setWorkingDir(
  newDir: string,
  sessionId?: string
): Promise<{ success: boolean; path: string; error?: string }> {
  const unsupportedReason = getWorkspacePathUnsupportedReason(newDir);
  if (unsupportedReason) {
    return { success: false, path: newDir, error: unsupportedReason };
  }

  if (!fs.existsSync(newDir)) {
    return { success: false, path: newDir, error: 'Directory does not exist' };
  }

  if (sessionId && mainAppState.sessionManager) {
    log('[App] Updating session cwd:', sessionId, '->', newDir);
    mainAppState.sessionManager.updateSessionCwd(sessionId, newDir);

    SandboxSync.clearSession(sessionId);
    const { LimaSync } = await import('./sandbox/lima-sync');
    LimaSync.clearSession(sessionId);
  }

  sendToRenderer({
    type: 'workdir.changed',
    payload: { path: newDir },
  });

  log(
    '[App] Working directory for UI updated:',
    newDir,
    sessionId ? `(session: ${sessionId})` : '(pending new session)'
  );

  return { success: true, path: newDir };
}

export async function startSandboxBootstrap(): Promise<void> {
  const sandboxEnabled = configStore.get('sandboxEnabled');
  if (sandboxEnabled === false) {
    log('[App] Sandbox disabled, skipping bootstrap (using native mode)');
    return;
  }

  const bootstrap = getSandboxBootstrap();

  if (bootstrap.isComplete()) {
    log('[App] Sandbox bootstrap already complete');
    return;
  }

  bootstrap.setProgressCallback((progress) => {
    sendToRenderer({
      type: 'sandbox.progress',
      payload: progress,
    });
  });

  log('[App] Starting sandbox bootstrap...');
  try {
    const result = await bootstrap.bootstrap();
    log('[App] Sandbox bootstrap complete:', result.mode);
  } catch (error) {
    logError('[App] Sandbox bootstrap error:', error);
  }
}
