/**
 * @module main/quick-ask/quick-ask-controller
 *
 * Wires config ↔ globalShortcut ↔ Quick Ask window. Safe no-ops when disabled.
 */
import { globalShortcut } from 'electron';
import { configStore } from '../config/config-store';
import { log, logWarn } from '../utils/logger';
import { mainAppState } from '../main-app-state';
import { sendToRenderer } from '../main-renderer-bridge';
import {
  DEFAULT_QUICK_ASK_SHORTCUT,
  normalizeQuickAskShortcut,
} from '../../shared/quick-ask';
import {
  registerQuickAskShortcut,
  unregisterQuickAskShortcut,
  type QuickAskShortcutRegistrationResult,
} from './quick-ask-shortcut';
import {
  destroyQuickAskWindow,
  hideQuickAskWindow,
  toggleQuickAskWindow,
} from './quick-ask-window';
import { ensureMainWindowVisible } from './quick-ask-open-in-app';
import { getDatabase } from '../db/database';
import { listChatFolders } from '../session/chat-folders-store';

export interface QuickAskStatusPayload {
  enabled: boolean;
  shortcut: string;
  registered: boolean;
  error: string | null;
}

function shortcutApi() {
  return {
    register: (accelerator: string, callback: () => void) =>
      globalShortcut.register(accelerator, callback),
    unregister: (accelerator: string) => globalShortcut.unregister(accelerator),
    isRegistered: (accelerator: string) => globalShortcut.isRegistered(accelerator),
  };
}

function broadcastStatus(): void {
  const status = getQuickAskStatus();
  sendToRenderer({ type: 'quickAsk.status', payload: status });
}

export function getQuickAskStatus(): QuickAskStatusPayload {
  const enabled = configStore.get('quickAskEnabled') === true;
  const shortcut =
    normalizeQuickAskShortcut(configStore.get('quickAskShortcut')) || DEFAULT_QUICK_ASK_SHORTCUT;
  return {
    enabled,
    shortcut,
    registered: mainAppState.quickAskShortcutRegistered,
    error: mainAppState.quickAskShortcutError,
  };
}

/**
 * Sync global shortcut registration with current config.
 * Call after app ready and whenever quick-ask config changes.
 */
export function syncQuickAskFromConfig(): QuickAskShortcutRegistrationResult | null {
  const enabled = configStore.get('quickAskEnabled') === true;
  const rawShortcut = configStore.get('quickAskShortcut');
  const shortcut = normalizeQuickAskShortcut(rawShortcut) || DEFAULT_QUICK_ASK_SHORTCUT;

  if (!enabled) {
    unregisterQuickAskShortcut(shortcutApi());
    mainAppState.quickAskShortcutRegistered = false;
    mainAppState.quickAskShortcutError = null;
    hideQuickAskWindow();
    broadcastStatus();
    log('[QuickAsk] Feature disabled — shortcut unregistered');
    return null;
  }

  const result = registerQuickAskShortcut(shortcut, () => toggleQuickAskWindow(), shortcutApi());

  mainAppState.quickAskShortcutRegistered = result.ok;
  if (result.ok) {
    mainAppState.quickAskShortcutError = null;
    log('[QuickAsk] Shortcut registered:', result.accelerator);
  } else {
    const message =
      result.error === 'shortcut_taken'
        ? 'shortcut_taken'
        : result.error || 'shortcut_register_failed';
    mainAppState.quickAskShortcutError = message;
    logWarn('[QuickAsk] Shortcut registration failed:', message, result.accelerator);
  }

  broadcastStatus();
  return result;
}

/** Unregister shortcut and destroy window — call on app quit. */
export function shutdownQuickAsk(): void {
  unregisterQuickAskShortcut(shortcutApi());
  mainAppState.quickAskShortcutRegistered = false;
  destroyQuickAskWindow();
}

export function openQuickAskSessionInMain(sessionId: string): void {
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    return;
  }
  const id = sessionId.trim();
  hideQuickAskWindow();
  ensureMainWindowVisible();

  // Refresh the session list so the main window knows about the Quick Ask session
  // (it may have been created only in the Quick Ask renderer via invoke).
  const sessions = mainAppState.sessionManager?.listSessions() ?? [];
  let folders: ReturnType<typeof listChatFolders> = [];
  try {
    folders = listChatFolders(getDatabase());
  } catch {
    folders = [];
  }
  sendToRenderer({ type: 'session.list', payload: { sessions, folders } });

  sendToRenderer({
    type: 'navigate.to',
    payload: { page: 'session', sessionId: id },
  });
}
