/**
 * Facade for run checkpoints: start/end run, capture, restore, retention purge.
 */
import * as path from 'node:path';
import { configStore } from '../config/config-store';
import { log, logWarn } from '../utils/logger';
import {
  captureFilePreImage,
  createRunJournal,
  finalizeRunJournal,
  findRunForMessage,
  getRunSummary,
  listSessionRunSummaries,
  purgeOldRuns,
  purgeSessionCheckpoints,
  registerMessageId,
  restoreRun,
} from './checkpoint-store';
import { startCheckpointWatcher, type CheckpointWatcherHandle } from './checkpoint-watcher';
import {
  CHECKPOINT_DEFAULT_RETENTION,
  type CheckpointCaptureSource,
  type CheckpointRestoreResult,
  type CheckpointRunSummary,
} from './types';

interface ActiveCheckpointRun {
  sessionId: string;
  runId: string;
  workspaceRoot: string;
  watcher: CheckpointWatcherHandle | null;
}

class CheckpointService {
  private readonly activeBySession = new Map<string, ActiveCheckpointRun>();
  /** Sessions currently executing an agent run (for restore refusal). */
  private readonly runningSessions = new Set<string>();

  isEnabled(): boolean {
    return configStore.get('checkpointsEnabled') !== false;
  }

  markSessionRunning(sessionId: string, running: boolean): void {
    if (running) {
      this.runningSessions.add(sessionId);
    } else {
      this.runningSessions.delete(sessionId);
    }
  }

  isSessionRunning(sessionId: string): boolean {
    return this.runningSessions.has(sessionId);
  }

  getActiveRun(sessionId: string): ActiveCheckpointRun | null {
    return this.activeBySession.get(sessionId) ?? null;
  }

  startRun(sessionId: string, runId: string, workspaceRoot: string): void {
    if (!this.isEnabled()) {
      return;
    }
    const normalizedRoot = path.normalize(workspaceRoot);
    if (!normalizedRoot) {
      return;
    }

    const existing = this.activeBySession.get(sessionId);
    if (existing) {
      void existing.watcher?.stop();
      this.activeBySession.delete(sessionId);
    }

    try {
      createRunJournal(sessionId, runId, normalizedRoot);
    } catch (error) {
      logWarn('[Checkpoints] Failed to create journal — checkpoints disabled for run:', error);
      return;
    }

    let watcher: CheckpointWatcherHandle | null = null;
    try {
      watcher = startCheckpointWatcher({ sessionId, runId, workspaceRoot: normalizedRoot });
    } catch (error) {
      logWarn('[Checkpoints] Watcher unavailable (write/edit still covered):', error);
    }

    this.activeBySession.set(sessionId, {
      sessionId,
      runId,
      workspaceRoot: normalizedRoot,
      watcher,
    });
    log(`[Checkpoints] Started run ${runId} for session ${sessionId}`);
  }

  async endRun(sessionId: string, runId: string): Promise<CheckpointRunSummary | null> {
    const active = this.activeBySession.get(sessionId);
    if (active && active.runId === runId) {
      await active.watcher?.stop();
      this.activeBySession.delete(sessionId);
    }

    if (!this.isEnabled()) {
      return null;
    }

    try {
      const journal = finalizeRunJournal(sessionId, runId);
      purgeOldRuns(sessionId, CHECKPOINT_DEFAULT_RETENTION);
      if (!journal) {
        return null;
      }
      return getRunSummary(sessionId, runId);
    } catch (error) {
      logWarn('[Checkpoints] endRun failed:', error);
      return null;
    }
  }

  tryRegisterAssistantMessage(sessionId: string, messageId: string): void {
    const active = this.activeBySession.get(sessionId);
    if (!active) {
      return;
    }
    try {
      registerMessageId(sessionId, active.runId, messageId);
    } catch (error) {
      logWarn('[Checkpoints] registerMessage failed:', error);
    }
  }

  capturePath(
    sessionId: string,
    absolutePath: string,
    source: CheckpointCaptureSource
  ): void {
    if (!this.isEnabled()) {
      return;
    }
    const active = this.activeBySession.get(sessionId);
    if (!active) {
      return;
    }
    try {
      captureFilePreImage({
        sessionId,
        runId: active.runId,
        absolutePath,
        workspaceRoot: active.workspaceRoot,
        source,
      });
    } catch (error) {
      logWarn('[Checkpoints] capturePath failed:', error);
    }
  }

  resolveWorkspacePath(workspaceRoot: string, filePath: string): string {
    if (path.isAbsolute(filePath) || /^[a-zA-Z]:/.test(filePath)) {
      return path.normalize(filePath);
    }
    return path.normalize(path.join(workspaceRoot, filePath));
  }

  getSummaryForMessage(sessionId: string, messageId: string): CheckpointRunSummary | null {
    try {
      return findRunForMessage(sessionId, messageId);
    } catch (error) {
      logWarn('[Checkpoints] getSummaryForMessage failed:', error);
      return null;
    }
  }

  listForSession(sessionId: string): CheckpointRunSummary[] {
    try {
      return listSessionRunSummaries(sessionId);
    } catch (error) {
      logWarn('[Checkpoints] listForSession failed:', error);
      return [];
    }
  }

  restore(sessionId: string, runId: string): CheckpointRestoreResult {
    return restoreRun(sessionId, runId, {
      refuseIfActive: true,
      isSessionActive: () => this.isSessionRunning(sessionId),
    });
  }

  purgeSession(sessionId: string): void {
    const active = this.activeBySession.get(sessionId);
    if (active) {
      void active.watcher?.stop();
      this.activeBySession.delete(sessionId);
    }
    this.runningSessions.delete(sessionId);
    try {
      purgeSessionCheckpoints(sessionId);
    } catch (error) {
      logWarn('[Checkpoints] purgeSession failed:', error);
    }
  }
}

export const checkpointService = new CheckpointService();
