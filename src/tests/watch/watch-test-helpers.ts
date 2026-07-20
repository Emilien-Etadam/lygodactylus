/**
 * In-memory WatchStore for unit tests (no electron-store).
 */
import { randomUUID } from 'node:crypto';
import type { Watcher } from '../../shared/watch';
import { WatchStore, type WatchStoreBackend } from '../../main/watch/watch-store';

/** Minimal mutable bag mimicking electron-store get/set for WatchStore. */
export function createMemoryWatchStore(): WatchStore {
  const data: { watchers: Watcher[] } = { watchers: [] };
  const fakeStore: WatchStoreBackend = {
    get: (_key, fallback = []) => data.watchers ?? fallback,
    set: (_key, value) => {
      data.watchers = value;
    },
  };
  return new WatchStore(fakeStore);
}

/** Helper to build a watcher without going through encrypted store defaults. */
export function makeWatcher(overrides: Partial<Watcher> & Pick<Watcher, 'type' | 'target'>): Watcher {
  const now = Date.now();
  return {
    id: overrides.id ?? randomUUID(),
    type: overrides.type,
    target: overrides.target,
    label: overrides.label ?? '',
    scheduleConfig: overrides.scheduleConfig ?? { kind: 'daily', times: ['08:00'] },
    repeatEvery: overrides.repeatEvery ?? null,
    repeatUnit: overrides.repeatUnit ?? null,
    enabled: overrides.enabled ?? true,
    lastState: overrides.lastState ?? null,
    runAt: overrides.runAt ?? now,
    nextRunAt: overrides.nextRunAt ?? now,
    lastRunAt: overrides.lastRunAt ?? null,
    lastDigestSessionId: overrides.lastDigestSessionId ?? null,
    lastError: overrides.lastError ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}
