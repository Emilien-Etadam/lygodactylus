/**
 * Content watch (Veille) — shared types, session identity, and pure helpers.
 * Tool gating uses session.mode='plan' via session-mode.ts.
 */

/** Internal session title used to find/reuse the dedicated Veille session. */
export const VEILLE_SESSION_TITLE = 'Veille';

/** Max GUIDs retained per RSS watcher (newest first). */
export const WATCH_RSS_GUID_LIMIT = 200;

/** Max UTF-8 bytes for URL unified-diff material in the digest prompt. */
export const WATCH_URL_DIFF_MAX_BYTES = 8 * 1024;

/**
 * Veille system-prompt section.
 * Replaces PLAN_MODE_SYSTEM_PROMPT so the model writes a concise digest
 * instead of a numbered action plan, while still using mode='plan' for tools.
 */
export const VEILLE_SYSTEM_PROMPT =
  '<veille>\nVeille mode: summarize only the new material provided in the user message. Use read-only tools only. Do not write files, run shell commands, or perform mutating actions. Do not invent items absent from the material.\n</veille>';

export type WatcherType = 'folder' | 'rss' | 'url';

/** Interval units allowed for watchers (frequencies &lt; 1h are out of scope). */
export type WatcherRepeatUnit = 'hour' | 'day';

export type WatcherWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface WatcherDailyScheduleConfig {
  kind: 'daily';
  times: string[];
}

export interface WatcherWeeklyScheduleConfig {
  kind: 'weekly';
  weekdays: WatcherWeekday[];
  times: string[];
}

/** Same shape as the existing schedule cron config (daily / weekly). */
export type WatcherScheduleConfig = WatcherDailyScheduleConfig | WatcherWeeklyScheduleConfig;

export interface FolderWatcherState {
  kind: 'folder';
  /** Absolute path → mtimeMs */
  files: Record<string, number>;
}

export interface RssWatcherState {
  kind: 'rss';
  /** Newest-first, capped at WATCH_RSS_GUID_LIMIT */
  guids: string[];
}

export interface UrlWatcherState {
  kind: 'url';
  hash: string;
  /** Previous extracted text (may be truncated for storage budget). */
  text: string;
}

export type WatcherLastState = FolderWatcherState | RssWatcherState | UrlWatcherState;

export interface Watcher {
  id: string;
  type: WatcherType;
  /** Absolute folder path, or http(s) URL for rss/url. */
  target: string;
  /** Optional display label. */
  label: string;
  scheduleConfig: WatcherScheduleConfig | null;
  repeatEvery: number | null;
  repeatUnit: WatcherRepeatUnit | null;
  enabled: boolean;
  lastState: WatcherLastState | null;
  runAt: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastDigestSessionId: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WatcherCreateInput {
  type: WatcherType;
  target: string;
  label?: string;
  scheduleConfig?: WatcherScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: WatcherRepeatUnit | null;
  runAt?: number;
  nextRunAt?: number | null;
  enabled?: boolean;
}

export interface WatcherUpdateInput {
  type?: WatcherType;
  target?: string;
  label?: string;
  scheduleConfig?: WatcherScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: WatcherRepeatUnit | null;
  runAt?: number;
  nextRunAt?: number | null;
  enabled?: boolean;
  lastState?: WatcherLastState | null;
  lastRunAt?: number | null;
  lastDigestSessionId?: string | null;
  lastError?: string | null;
}

export function isVeilleSessionTitle(title: unknown): boolean {
  return typeof title === 'string' && title === VEILLE_SESSION_TITLE;
}

export function findVeilleSession<T extends { id: string; title: string }>(
  sessions: readonly T[]
): T | undefined {
  return sessions.find((session) => isVeilleSessionTitle(session.title));
}

export function resolveVeilleSessionAction(
  sessions: readonly { id: string; title: string }[]
): { action: 'create' } | { action: 'reuse'; sessionId: string } {
  const existing = findVeilleSession(sessions);
  if (existing) {
    return { action: 'reuse', sessionId: existing.id };
  }
  return { action: 'create' };
}

/** Keep at most `limit` guids, newest first, de-duplicated. */
export function capRssGuids(guids: readonly string[], limit: number = WATCH_RSS_GUID_LIMIT): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const guid of guids) {
    const trimmed = guid.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= limit) break;
  }
  return result;
}
