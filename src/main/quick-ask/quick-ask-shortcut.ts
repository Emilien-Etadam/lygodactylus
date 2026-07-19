/**
 * @module main/quick-ask/quick-ask-shortcut
 *
 * Thin wrappers around Electron `globalShortcut` for Quick Ask.
 * Pure register/unregister helpers are unit-tested with an injected API.
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

let registeredAccelerator: string | null = null;

export function getRegisteredQuickAskAccelerator(): string | null {
  return registeredAccelerator;
}

/**
 * Register a global shortcut. Unregisters any previously registered Quick Ask
 * accelerator first. Never throws — failures become `{ ok: false, error }`.
 */
export function registerQuickAskShortcut(
  accelerator: string,
  callback: () => void,
  api: GlobalShortcutApi
): QuickAskShortcutRegistrationResult {
  const previous = registeredAccelerator;
  if (previous && previous !== accelerator) {
    try {
      api.unregister(previous);
    } catch {
      // Best-effort cleanup before switching accelerators.
    }
    registeredAccelerator = null;
  }

  try {
    if (previous === accelerator && api.isRegistered(accelerator)) {
      // Re-bind: unregister then register so the callback is refreshed.
      api.unregister(accelerator);
      registeredAccelerator = null;
    }

    const ok = api.register(accelerator, callback);
    if (!ok) {
      registeredAccelerator = null;
      return {
        ok: false,
        accelerator,
        error: 'shortcut_taken',
      };
    }
    registeredAccelerator = accelerator;
    return { ok: true, accelerator };
  } catch (error) {
    registeredAccelerator = null;
    return {
      ok: false,
      accelerator,
      error: error instanceof Error ? error.message : 'shortcut_register_failed',
    };
  }
}

/** Unregister the current Quick Ask accelerator (no-op if none). */
export function unregisterQuickAskShortcut(api: GlobalShortcutApi): void {
  const current = registeredAccelerator;
  if (!current) {
    return;
  }
  try {
    api.unregister(current);
  } catch {
    // Ignore unregister failures during shutdown.
  }
  registeredAccelerator = null;
}

/** Test helper — reset module state between vitest cases. */
export function resetQuickAskShortcutStateForTests(): void {
  registeredAccelerator = null;
}
