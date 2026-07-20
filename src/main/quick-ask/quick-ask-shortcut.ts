/**
 * @module main/quick-ask/quick-ask-shortcut
 *
 * Thin wrappers around Electron `globalShortcut` for Quick Ask.
 * Pure register/unregister helpers are unit-tested with an injected API.
 * Supports two slots: the floating Ask window and Sélection (clipboard).
 */

export interface GlobalShortcutApi {
  register: (accelerator: string, callback: () => void) => boolean;
  unregister: (accelerator: string) => void;
  isRegistered: (accelerator: string) => boolean;
  unregisterAll?: () => void;
}

export interface QuickAskShortcutRegistrationResult {
  ok: boolean;
  accelerator: string;
  /** Set when register() returned false or threw (e.g. already taken by the OS). */
  error?: string;
}

export type QuickAskShortcutSlot = 'ask' | 'selection';

const registeredAccelerators: Record<QuickAskShortcutSlot, string | null> = {
  ask: null,
  selection: null,
};

function otherSlot(slot: QuickAskShortcutSlot): QuickAskShortcutSlot {
  return slot === 'ask' ? 'selection' : 'ask';
}

export function getRegisteredQuickAskAccelerator(
  slot: QuickAskShortcutSlot = 'ask'
): string | null {
  return registeredAccelerators[slot];
}

/**
 * Register a global shortcut for a Quick Ask slot. Unregisters any previously
 * registered accelerator for that slot first. Never throws — failures become
 * `{ ok: false, error }`. Refuses when the other slot already owns the same
 * accelerator (Electron allows only one callback per accelerator).
 */
export function registerQuickAskShortcut(
  accelerator: string,
  callback: () => void,
  api: GlobalShortcutApi,
  slot: QuickAskShortcutSlot = 'ask'
): QuickAskShortcutRegistrationResult {
  if (registeredAccelerators[otherSlot(slot)] === accelerator) {
    return {
      ok: false,
      accelerator,
      error: 'shortcut_taken',
    };
  }

  const previous = registeredAccelerators[slot];
  if (previous && previous !== accelerator) {
    try {
      api.unregister(previous);
    } catch {
      // Best-effort cleanup before switching accelerators.
    }
    registeredAccelerators[slot] = null;
  }

  try {
    if (previous === accelerator && api.isRegistered(accelerator)) {
      // Re-bind: unregister then register so the callback is refreshed.
      api.unregister(accelerator);
      registeredAccelerators[slot] = null;
    }

    const ok = api.register(accelerator, callback);
    if (!ok) {
      registeredAccelerators[slot] = null;
      return {
        ok: false,
        accelerator,
        error: 'shortcut_taken',
      };
    }
    registeredAccelerators[slot] = accelerator;
    return { ok: true, accelerator };
  } catch (error) {
    registeredAccelerators[slot] = null;
    return {
      ok: false,
      accelerator,
      error: error instanceof Error ? error.message : 'shortcut_register_failed',
    };
  }
}

/** Unregister the current accelerator for a slot (no-op if none). */
export function unregisterQuickAskShortcut(
  api: GlobalShortcutApi,
  slot: QuickAskShortcutSlot = 'ask'
): void {
  const current = registeredAccelerators[slot];
  if (!current) {
    return;
  }
  try {
    api.unregister(current);
  } catch {
    // Ignore unregister failures during shutdown.
  }
  registeredAccelerators[slot] = null;
}

/** Unregister every Quick Ask shortcut slot. */
export function unregisterAllQuickAskShortcuts(api: GlobalShortcutApi): void {
  unregisterQuickAskShortcut(api, 'ask');
  unregisterQuickAskShortcut(api, 'selection');
}

/** Test helper — reset module state between vitest cases. */
export function resetQuickAskShortcutStateForTests(): void {
  registeredAccelerators.ask = null;
  registeredAccelerators.selection = null;
}
