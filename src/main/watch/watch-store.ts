/**
 * @module main/watch/watch-store
 *
 * Dedicated encrypted userData store for content-watch (Veille) watchers.
 * Not part of the global app config.
 */
import { randomUUID } from 'node:crypto';
import Store from 'electron-store';
import { createAppEncryptedStore } from '../utils/app-store';
import {
  capRssGuids,
  type Watcher,
  type WatcherCreateInput,
  type WatcherLastState,
  type WatcherRepeatUnit,
  type WatcherScheduleConfig,
  type WatcherType,
  type WatcherUpdateInput,
  type WatcherWeekday,
} from '../../shared/watch';

interface WatchStoreData extends Record<string, unknown> {
  watchers: Watcher[];
}

/** Minimal get/set surface so tests can inject an in-memory bag. */
export interface WatchStoreBackend {
  get(key: 'watchers', defaultValue?: Watcher[]): Watcher[];
  set(key: 'watchers', value: Watcher[]): void;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function normalizeLabel(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTarget(type: WatcherType, target: string): string {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new Error('Watcher target is required');
  }
  if (type === 'folder') {
    return trimmed;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Watcher target must be a valid http(s) URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Watcher target must be a valid http(s) URL');
  }
  return parsed.toString();
}

function normalizeType(value: unknown): WatcherType {
  if (value === 'folder' || value === 'rss' || value === 'url') {
    return value;
  }
  throw new Error('Watcher type must be folder, rss, or url');
}

function normalizeRepeatUnit(value: unknown): WatcherRepeatUnit | null {
  if (value === 'hour' || value === 'day') {
    return value;
  }
  if (value === 'minute') {
    throw new Error('Watcher frequency must be at least 1 hour');
  }
  return null;
}

function normalizeRepeatEvery(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return null;
  }
  return normalized;
}

function normalizeTimes(times: unknown): string[] {
  if (!Array.isArray(times)) {
    return [];
  }
  return Array.from(
    new Set(times.filter((time): time is string => typeof time === 'string' && TIME_PATTERN.test(time)))
  ).sort();
}

function normalizeWeekdays(days: unknown): WatcherWeekday[] {
  if (!Array.isArray(days)) {
    return [];
  }
  return Array.from(
    new Set(
      days.filter(
        (day): day is WatcherWeekday => Number.isInteger(day) && day >= 0 && day <= 6
      )
    )
  ).sort((a, b) => a - b);
}

export function normalizeWatcherScheduleConfig(
  value: WatcherScheduleConfig | null | undefined
): WatcherScheduleConfig | null {
  if (!value) {
    return null;
  }
  if (value.kind === 'daily') {
    const times = normalizeTimes(value.times);
    if (times.length === 0) return null;
    return { kind: 'daily', times };
  }
  if (value.kind === 'weekly') {
    const times = normalizeTimes(value.times);
    const weekdays = normalizeWeekdays(value.weekdays);
    if (times.length === 0 || weekdays.length === 0) return null;
    return { kind: 'weekly', weekdays, times };
  }
  return null;
}

function assertMinFrequency(
  scheduleConfig: WatcherScheduleConfig | null,
  repeatEvery: number | null,
  repeatUnit: WatcherRepeatUnit | null
): void {
  if (scheduleConfig) {
    return;
  }
  if (!repeatEvery || !repeatUnit) {
    throw new Error('Watcher requires a daily/weekly schedule or an interval of at least 1 hour');
  }
  if (repeatUnit === 'hour' && repeatEvery < 1) {
    throw new Error('Watcher frequency must be at least 1 hour');
  }
}

function normalizeLastState(value: WatcherLastState | null | undefined): WatcherLastState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  if (value.kind === 'folder' && value.files && typeof value.files === 'object') {
    const files: Record<string, number> = {};
    for (const [key, mtime] of Object.entries(value.files)) {
      if (typeof mtime === 'number' && Number.isFinite(mtime)) {
        files[key] = mtime;
      }
    }
    return { kind: 'folder', files };
  }
  if (value.kind === 'rss' && Array.isArray(value.guids)) {
    return {
      kind: 'rss',
      guids: capRssGuids(value.guids.filter((g): g is string => typeof g === 'string')),
    };
  }
  if (value.kind === 'url' && typeof value.hash === 'string' && typeof value.text === 'string') {
    return { kind: 'url', hash: value.hash, text: value.text };
  }
  return null;
}

export class WatchStore {
  private store: WatchStoreBackend;

  constructor(store?: WatchStoreBackend) {
    this.store =
      store ??
      (createAppEncryptedStore<WatchStoreData>({
        name: 'content-watch',
        defaults: { watchers: [] },
        logPrefix: '[WatchStore]',
      }) as Store<WatchStoreData>);
  }

  list(): Watcher[] {
    return [...this.store.get('watchers', [])].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): Watcher | null {
    return this.store.get('watchers', []).find((watcher) => watcher.id === id) ?? null;
  }

  create(input: WatcherCreateInput): Watcher {
    const type = normalizeType(input.type);
    const target = normalizeTarget(type, input.target);
    const scheduleConfig = normalizeWatcherScheduleConfig(input.scheduleConfig);
    const repeatEvery = scheduleConfig ? null : normalizeRepeatEvery(input.repeatEvery);
    const repeatUnit = scheduleConfig ? null : normalizeRepeatUnit(input.repeatUnit);
    assertMinFrequency(scheduleConfig, repeatEvery, repeatUnit);

    const now = Date.now();
    const runAt =
      typeof input.runAt === 'number' && Number.isFinite(input.runAt) ? input.runAt : now;
    const watcher: Watcher = {
      id: randomUUID(),
      type,
      target,
      label: normalizeLabel(input.label),
      scheduleConfig,
      repeatEvery,
      repeatUnit,
      enabled: input.enabled !== false,
      lastState: null,
      runAt,
      nextRunAt:
        input.nextRunAt === undefined
          ? runAt
          : input.nextRunAt,
      lastRunAt: null,
      lastDigestSessionId: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    const watchers = this.store.get('watchers', []);
    watchers.push(watcher);
    this.store.set('watchers', watchers);
    return watcher;
  }

  update(id: string, updates: WatcherUpdateInput): Watcher | null {
    const watchers = this.store.get('watchers', []);
    const index = watchers.findIndex((watcher) => watcher.id === id);
    if (index < 0) {
      return null;
    }

    const current = watchers[index]!;
    const type = updates.type === undefined ? current.type : normalizeType(updates.type);
    const target =
      updates.target === undefined ? current.target : normalizeTarget(type, updates.target);
    const scheduleConfig =
      updates.scheduleConfig === undefined
        ? current.scheduleConfig
        : normalizeWatcherScheduleConfig(updates.scheduleConfig);
    const usesSchedule = scheduleConfig !== null;
    const repeatEvery = usesSchedule
      ? null
      : updates.repeatEvery === undefined
        ? current.repeatEvery
        : normalizeRepeatEvery(updates.repeatEvery);
    const repeatUnit = usesSchedule
      ? null
      : updates.repeatUnit === undefined
        ? current.repeatUnit
        : normalizeRepeatUnit(updates.repeatUnit);

    if (
      updates.scheduleConfig !== undefined ||
      updates.repeatEvery !== undefined ||
      updates.repeatUnit !== undefined
    ) {
      assertMinFrequency(scheduleConfig, repeatEvery, repeatUnit);
    }

    const next: Watcher = {
      ...current,
      type,
      target,
      label: updates.label === undefined ? current.label : normalizeLabel(updates.label),
      scheduleConfig,
      repeatEvery,
      repeatUnit,
      enabled: updates.enabled === undefined ? current.enabled : updates.enabled,
      lastState:
        updates.lastState === undefined
          ? current.lastState
          : normalizeLastState(updates.lastState),
      runAt:
        updates.runAt === undefined
          ? current.runAt
          : updates.runAt,
      nextRunAt:
        updates.nextRunAt === undefined ? current.nextRunAt : updates.nextRunAt,
      lastRunAt:
        updates.lastRunAt === undefined ? current.lastRunAt : updates.lastRunAt,
      lastDigestSessionId:
        updates.lastDigestSessionId === undefined
          ? current.lastDigestSessionId
          : updates.lastDigestSessionId,
      lastError: updates.lastError === undefined ? current.lastError : updates.lastError,
      updatedAt: Date.now(),
    };

    watchers[index] = next;
    this.store.set('watchers', watchers);
    return next;
  }

  delete(id: string): boolean {
    const watchers = this.store.get('watchers', []);
    const next = watchers.filter((watcher) => watcher.id !== id);
    if (next.length === watchers.length) {
      return false;
    }
    this.store.set('watchers', next);
    return true;
  }
}

export const watchStore = new WatchStore();
