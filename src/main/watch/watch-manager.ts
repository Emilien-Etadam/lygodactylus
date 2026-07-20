/**
 * @module main/watch/watch-manager
 *
 * Content-watch orchestration. Reuses ScheduledTaskManager (same cron backend)
 * with a store adapter over the dedicated WatchStore — does not invent a second
 * timer engine.
 */
import {
  ScheduledTaskManager,
  computeNextRunAtFromScheduleConfig,
  type ScheduledTask,
  type ScheduledTaskCreateInput,
  type ScheduledTaskStore,
  type ScheduledTaskUpdateInput,
} from '../schedule/scheduled-task-manager';
import type {
  Watcher,
  WatcherCreateInput,
  WatcherScheduleConfig,
  WatcherUpdateInput,
} from '../../shared/watch';
import { log, logError } from '../utils/logger';
import { detectWatcherChanges, type WatchDetectionResult } from './watch-detect';
import { deliverVeilleDigest } from './watch-digest';
import { WatchStore, normalizeWatcherScheduleConfig } from './watch-store';
import type { SessionManager } from '../session/session-manager';

export interface WatchManagerDeps {
  store?: WatchStore;
  getSessionManager: () => SessionManager | null;
  sendSessionUpdate?: (sessionId: string, session: unknown) => void;
  onWatcherError?: (watcherId: string, error: string) => void;
  now?: () => number;
  /** Injected for tests. */
  detectChanges?: typeof detectWatcherChanges;
  deliverDigest?: typeof deliverVeilleDigest;
}

function watcherToScheduledTask(watcher: Watcher): ScheduledTask {
  return {
    id: watcher.id,
    title: watcher.label || watcher.target,
    prompt: `[veille:${watcher.type}] ${watcher.target}`,
    cwd: '/',
    runAt: watcher.runAt,
    nextRunAt: watcher.nextRunAt,
    scheduleConfig: watcher.scheduleConfig as ScheduledTask['scheduleConfig'],
    repeatEvery: watcher.repeatEvery,
    repeatUnit: watcher.repeatUnit,
    enabled: watcher.enabled,
    lastRunAt: watcher.lastRunAt,
    lastRunSessionId: watcher.lastDigestSessionId,
    lastError: watcher.lastError,
    createdAt: watcher.createdAt,
    updatedAt: watcher.updatedAt,
  };
}

function mapTaskUpdatesToWatcher(updates: ScheduledTaskUpdateInput): WatcherUpdateInput {
  const mapped: WatcherUpdateInput = {};
  if (updates.enabled !== undefined) mapped.enabled = updates.enabled;
  if (updates.runAt !== undefined) mapped.runAt = updates.runAt;
  if (updates.nextRunAt !== undefined) mapped.nextRunAt = updates.nextRunAt;
  if (updates.lastRunAt !== undefined) mapped.lastRunAt = updates.lastRunAt;
  if (updates.lastError !== undefined) mapped.lastError = updates.lastError;
  if (updates.lastRunSessionId !== undefined) {
    mapped.lastDigestSessionId = updates.lastRunSessionId;
  }
  if (updates.scheduleConfig !== undefined) {
    mapped.scheduleConfig = updates.scheduleConfig as WatcherScheduleConfig | null;
  }
  if (updates.repeatEvery !== undefined) mapped.repeatEvery = updates.repeatEvery;
  if (updates.repeatUnit !== undefined) {
    if (updates.repeatUnit === 'minute') {
      throw new Error('Watcher frequency must be at least 1 hour');
    }
    mapped.repeatUnit = updates.repeatUnit;
  }
  return mapped;
}

function computeInitialNextRunAt(
  input: WatcherCreateInput,
  now: number
): { runAt: number; nextRunAt: number } {
  const scheduleConfig = normalizeWatcherScheduleConfig(input.scheduleConfig);
  if (scheduleConfig) {
    const next = computeNextRunAtFromScheduleConfig(scheduleConfig, now);
    if (next === null) {
      throw new Error('Could not compute the next run time from the provided schedule');
    }
    return { runAt: next, nextRunAt: next };
  }
  const runAt =
    typeof input.runAt === 'number' && Number.isFinite(input.runAt) && input.runAt > now
      ? input.runAt
      : now + 60 * 60 * 1000;
  return { runAt, nextRunAt: input.nextRunAt ?? runAt };
}

export class WatchManager {
  private readonly store: WatchStore;
  private readonly scheduler: ScheduledTaskManager;
  private readonly getSessionManager: () => SessionManager | null;
  private readonly sendSessionUpdate?: (sessionId: string, session: unknown) => void;
  private readonly onWatcherError?: (watcherId: string, error: string) => void;
  private readonly now: () => number;
  private readonly detectChanges: typeof detectWatcherChanges;
  private readonly deliverDigest: typeof deliverVeilleDigest;

  constructor(deps: WatchManagerDeps) {
    this.store = deps.store ?? new WatchStore();
    this.getSessionManager = deps.getSessionManager;
    this.sendSessionUpdate = deps.sendSessionUpdate;
    this.onWatcherError = deps.onWatcherError;
    this.now = deps.now ?? (() => Date.now());
    this.detectChanges = deps.detectChanges ?? detectWatcherChanges;
    this.deliverDigest = deps.deliverDigest ?? deliverVeilleDigest;

    const adapter: ScheduledTaskStore = {
      list: () => this.store.list().map(watcherToScheduledTask),
      get: (id) => {
        const watcher = this.store.get(id);
        return watcher ? watcherToScheduledTask(watcher) : null;
      },
      create: (_input: ScheduledTaskCreateInput) => {
        throw new Error('Use WatchManager.create for watchers');
      },
      update: (id, updates) => {
        const updated = this.store.update(id, mapTaskUpdatesToWatcher(updates));
        return updated ? watcherToScheduledTask(updated) : null;
      },
      delete: (id) => this.store.delete(id),
    };

    this.scheduler = new ScheduledTaskManager({
      store: adapter,
      executeTask: async (task) => this.executeWatcher(task.id),
      onTaskError: (taskId, error) => this.onWatcherError?.(taskId, error),
      now: this.now,
    });
  }

  start(): void {
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
  }

  list(): Watcher[] {
    return this.store.list().sort((a, b) => {
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }
      const aNext = a.nextRunAt ?? Number.MAX_SAFE_INTEGER;
      const bNext = b.nextRunAt ?? Number.MAX_SAFE_INTEGER;
      if (aNext !== bNext) return aNext - bNext;
      return b.createdAt - a.createdAt;
    });
  }

  get(id: string): Watcher | null {
    return this.store.get(id);
  }

  create(input: WatcherCreateInput): Watcher {
    const timing = computeInitialNextRunAt(input, this.now());
    const created = this.store.create({
      ...input,
      runAt: timing.runAt,
      nextRunAt: timing.nextRunAt,
    });
    // Kick the shared cron engine so the new watcher is scheduled.
    this.scheduler.update(created.id, {
      enabled: created.enabled,
      runAt: created.runAt,
      nextRunAt: created.nextRunAt,
    });
    return this.store.get(created.id) ?? created;
  }

  update(id: string, updates: WatcherUpdateInput): Watcher | null {
    const current = this.store.get(id);
    if (!current) return null;

    const nextUpdates: WatcherUpdateInput = { ...updates };
    if (
      updates.scheduleConfig !== undefined ||
      updates.repeatEvery !== undefined ||
      updates.repeatUnit !== undefined ||
      updates.runAt !== undefined
    ) {
      const timing = computeInitialNextRunAt(
        {
          type: updates.type ?? current.type,
          target: updates.target ?? current.target,
          scheduleConfig:
            updates.scheduleConfig === undefined
              ? current.scheduleConfig
              : updates.scheduleConfig,
          repeatEvery:
            updates.repeatEvery === undefined ? current.repeatEvery : updates.repeatEvery,
          repeatUnit:
            updates.repeatUnit === undefined ? current.repeatUnit : updates.repeatUnit,
          runAt: updates.runAt === undefined ? current.runAt : updates.runAt,
        },
        this.now()
      );
      if (updates.scheduleConfig !== undefined || updates.runAt !== undefined) {
        nextUpdates.runAt = timing.runAt;
        nextUpdates.nextRunAt = timing.nextRunAt;
      }
    }

    const updated = this.store.update(id, nextUpdates);
    if (!updated) return null;
    this.scheduler.update(id, {
      enabled: updated.enabled,
      runAt: updated.runAt,
      nextRunAt: updated.nextRunAt,
      scheduleConfig: updated.scheduleConfig,
      repeatEvery: updated.repeatEvery,
      repeatUnit: updated.repeatUnit,
    });
    return this.store.get(id);
  }

  delete(id: string): boolean {
    return this.scheduler.delete(id);
  }

  toggle(id: string, enabled: boolean): Watcher | null {
    const updated = this.scheduler.toggle(id, enabled);
    return updated ? this.store.get(id) : null;
  }

  async runNow(id: string): Promise<Watcher | null> {
    await this.scheduler.runNow(id);
    return this.store.get(id);
  }

  /**
   * Pure tick used by tests: detect changes, update lastState, optionally digest.
   * Returns whether a digest message was sent.
   */
  async tickWatcher(id: string): Promise<{ digested: boolean; sessionId: string }> {
    const result = await this.executeWatcher(id);
    return { digested: result.digested === true, sessionId: result.sessionId };
  }

  private async executeWatcher(
    id: string
  ): Promise<{ sessionId: string; digested?: boolean }> {
    const watcher = this.store.get(id);
    if (!watcher) {
      throw new Error(`Watcher not found: ${id}`);
    }

    let detection: WatchDetectionResult;
    try {
      detection = await this.detectChanges(watcher);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`[Veille] Detection failed for ${id}:`, error);
      this.store.update(id, { lastError: message, lastRunAt: this.now() });
      throw error instanceof Error ? error : new Error(message);
    }

    this.store.update(id, {
      lastState: detection.nextState,
      lastError: null,
    });

    if (!detection.hasNews) {
      log(`[Veille] No news for watcher ${id} (baseline=${detection.baselineOnly})`);
      return { sessionId: watcher.lastDigestSessionId ?? '', digested: false };
    }

    const sessionManager = this.getSessionManager();
    if (!sessionManager) {
      throw new Error('Session manager not initialized');
    }

    const delivery = await this.deliverDigest({
      sessionManager,
      results: [{ watcher, result: detection }],
      sendSessionUpdate: this.sendSessionUpdate,
    });

    if (delivery.delivered && delivery.sessionId) {
      this.store.update(id, { lastDigestSessionId: delivery.sessionId });
    }

    return { sessionId: delivery.sessionId, digested: delivery.delivered };
  }
}
