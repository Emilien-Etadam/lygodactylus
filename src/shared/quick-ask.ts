/**
 * Quick Ask — shared constants and pure helpers (shortcut format, session identity,
 * system prompt). Tool gating for Quick Ask uses session.mode='plan' via
 * session-mode.ts — do not duplicate allowlists here.
 */

/** Internal session title used to find/reuse the dedicated Quick Ask session. */
export const QUICK_ASK_SESSION_TITLE = 'Quick Ask';

/** Default global accelerator (Electron Accelerator string). */
export const DEFAULT_QUICK_ASK_SHORTCUT = 'CommandOrControl+Shift+Space';

/**
 * Quick Ask system-prompt section.
 * Replaces PLAN_MODE_SYSTEM_PROMPT for Quick Ask sessions (which still use
 * mode='plan' for the single tool-gating point in session-mode.ts). Plan mode's
 * "produce a numbered action plan" instruction is the wrong UX for a floating
 * Q&A window — this prompt asks for a concise read-only answer instead.
 */
export const QUICK_ASK_SYSTEM_PROMPT =
  '<quick_ask>\nQuick Ask mode: answer the user concisely using read-only tools only. Do not write files, run shell commands, or perform mutating actions.\n</quick_ask>';

const ACCELERATOR_MODIFIERS = new Set([
  'CommandOrControl',
  'CmdOrCtrl',
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'Alt',
  'Option',
  'AltGr',
  'Shift',
  'Super',
  'Meta',
]);

const ACCELERATOR_KEYS = new Set([
  'Space',
  'Plus',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Return',
  'Enter',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'Esc',
  'VolumeUp',
  'VolumeDown',
  'VolumeMute',
  'MediaNextTrack',
  'MediaPreviousTrack',
  'MediaStop',
  'MediaPlayPause',
  'PrintScreen',
]);

const SINGLE_KEY_PATTERN = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/;

export function isQuickAskSessionTitle(title: unknown): boolean {
  return typeof title === 'string' && title === QUICK_ASK_SESSION_TITLE;
}

export function findQuickAskSession<T extends { id: string; title: string }>(
  sessions: readonly T[]
): T | undefined {
  return sessions.find((session) => isQuickAskSessionTitle(session.title));
}

/**
 * Decide whether to create a new Quick Ask session or reuse an existing one.
 * Pure helper for tests and renderer/main callers.
 */
export function resolveQuickAskSessionAction(
  sessions: readonly { id: string; title: string }[]
): { action: 'create' } | { action: 'reuse'; sessionId: string } {
  const existing = findQuickAskSession(sessions);
  if (existing) {
    return { action: 'reuse', sessionId: existing.id };
  }
  return { action: 'create' };
}

/**
 * Validate an Electron Accelerator string (modifiers + key).
 * Empty / whitespace-only → invalid. Normalizes modifier aliases for comparison
 * but returns the trimmed original when valid.
 */
export function isValidQuickAskShortcut(value: unknown): value is string {
  return normalizeQuickAskShortcut(value) !== null;
}

export function normalizeQuickAskShortcut(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split('+').map((part) => part.trim());
  if (parts.length < 2 || parts.some((part) => !part)) {
    return null;
  }

  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  if (!isAcceleratorKey(key)) {
    return null;
  }

  const seen = new Set<string>();
  for (const modifier of modifiers) {
    if (!ACCELERATOR_MODIFIERS.has(modifier)) {
      return null;
    }
    const canonical = canonicalizeModifier(modifier);
    if (seen.has(canonical)) {
      return null;
    }
    seen.add(canonical);
  }

  return trimmed;
}

function canonicalizeModifier(modifier: string): string {
  if (modifier === 'CmdOrCtrl' || modifier === 'CommandOrControl') {
    return 'CommandOrControl';
  }
  if (modifier === 'Cmd' || modifier === 'Command') {
    return 'Command';
  }
  if (modifier === 'Ctrl' || modifier === 'Control') {
    return 'Control';
  }
  if (modifier === 'Option' || modifier === 'Alt') {
    return 'Alt';
  }
  if (modifier === 'Meta' || modifier === 'Super') {
    return 'Super';
  }
  return modifier;
}

function isAcceleratorKey(key: string): boolean {
  if (ACCELERATOR_KEYS.has(key)) {
    return true;
  }
  return SINGLE_KEY_PATTERN.test(key);
}
