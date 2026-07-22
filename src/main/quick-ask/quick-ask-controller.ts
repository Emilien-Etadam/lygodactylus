/**
 * @module main/quick-ask/quick-ask-controller
 *
 * Wires config ↔ globalShortcut ↔ Quick Ask window. Safe no-ops when disabled.
 * Registers two shortcuts when enabled: Ask (toggle) and Sélection (clipboard).
 */
import { clipboard, globalShortcut } from 'electron';
import { configStore } from '../config/config-store';
import { log, logWarn } from '../utils/logger';
import { mainAppState } from '../main-app-state';
import { sendToRenderer } from '../main-renderer-bridge';
import {
  DEFAULT_QUICK_ASK_SELECTION_SHORTCUT,
  DEFAULT_QUICK_ASK_SHORTCUT,
  normalizeQuickAskShortcut,
  prepareQuickAskClipboardText,
} from '../../shared/quick-ask';
import {
  registerQuickAskShortcut,
  unregisterAllQuickAskShortcuts,
  type QuickAskShortcutRegistrationResult,
} from './quick-ask-shortcut';
import {
  destroyQuickAskWindow,
  hideQuickAskWindow,
  showQuickAskSelectionWindow,
  toggleQuickAskWindow,
} from './quick-ask-window';
import { ensureMainWindowVisible } from './quick-ask-open-in-app';
import { getDatabase } from '../db/database';
import { safeListChatFolders } from '../session/chat-folders-store';

export interface QuickAskStatusPayload {
  enabled: boolean;
  shortcut: string;
  registered: boolean;
  error: string | null;
  selectionShortcut: string;
  selectionRegistered: boolean;
  selectionError: string | null;
}

function shortcutApi() {
  return {
    register: (accelerator: string, callback: () => void) =>
      globalShortcut.register(accelerator, callback),
    unregister: (accelerator: string) => globalShortcut.unregister(accelerator),
    isRegistered: (accelerator: string) => globalShortcut.isRegistered(accelerator),
  };
}

function resolveAskShortcut(): string {
  return (
    normalizeQuickAskShortcut(configStore.get('quickAskShortcut')) || DEFAULT_QUICK_ASK_SHORTCUT
  );
}

function resolveSelectionShortcut(): string {
  return (
    normalizeQuickAskShortcut(configStore.get('quickAskSelectionShortcut')) ||
    DEFAULT_QUICK_ASK_SELECTION_SHORTCUT
  );
}

function registrationErrorMessage(
  result: QuickAskShortcutRegistrationResult
): string {
  if (result.ok) {
    return '';
  }
  return result.error === 'shortcut_taken'
    ? 'shortcut_taken'
    : result.error || 'shortcut_register_failed';
}

function broadcastStatus(): void {
  const status = getQuickAskStatus();
  sendToRenderer({ type: 'quickAsk.status', payload: status });
}

export function getQuickAskStatus(): QuickAskStatusPayload {
  const enabled = configStore.get('quickAskEnabled') === true;
  return {
    enabled,
    shortcut: resolveAskShortcut(),
    registered: mainAppState.quickAskShortcutRegistered,
    error: mainAppState.quickAskShortcutError,
    selectionShortcut: resolveSelectionShortcut(),
    selectionRegistered: mainAppState.quickAskSelectionShortcutRegistered,
    selectionError: mainAppState.quickAskSelectionShortcutError,
  };
}

/** Read the system clipboard and open Quick Ask in Sélection mode. */
export function openQuickAskFromClipboard(): void {
  if (!configStore.get('quickAskEnabled')) {
    return;
  }

  let raw = '';
  try {
    raw = clipboard.readText();
  } catch (error) {
    logWarn('[QuickAsk] clipboard.readText failed:', error);
    raw = '';
  }

  const prepared = prepareQuickAskClipboardText(raw);
  showQuickAskSelectionWindow({
    mode: 'selection',
    sourceText: prepared.text,
    truncated: prepared.truncated,
    empty: prepared.empty,
  });
}

/**
 * Sync global shortcut registration with current config.
 * Call after app ready and whenever quick-ask config changes.
 */
export function syncQuickAskFromConfig(): {
  ask: QuickAskShortcutRegistrationResult | null;
  selection: QuickAskShortcutRegistrationResult | null;
} {
  const enabled = configStore.get('quickAskEnabled') === true;
  const askShortcut = resolveAskShortcut();
  const selectionShortcut = resolveSelectionShortcut();
  const api = shortcutApi();

  if (!enabled) {
    unregisterAllQuickAskShortcuts(api);
    mainAppState.quickAskShortcutRegistered = false;
    mainAppState.quickAskShortcutError = null;
    mainAppState.quickAskSelectionShortcutRegistered = false;
    mainAppState.quickAskSelectionShortcutError = null;
    hideQuickAskWindow();
    broadcastStatus();
    log('[QuickAsk] Feature disabled — shortcuts unregistered');
    return { ask: null, selection: null };
  }

  const askResult = registerQuickAskShortcut(
    askShortcut,
    () => toggleQuickAskWindow(),
    api,
    'ask'
  );

  mainAppState.quickAskShortcutRegistered = askResult.ok;
  if (askResult.ok) {
    mainAppState.quickAskShortcutError = null;
    log('[QuickAsk] Ask shortcut registered:', askResult.accelerator);
  } else {
    mainAppState.quickAskShortcutError = registrationErrorMessage(askResult);
    logWarn(
      '[QuickAsk] Ask shortcut registration failed:',
      mainAppState.quickAskShortcutError,
      askResult.accelerator
    );
  }

  const selectionResult = registerQuickAskShortcut(
    selectionShortcut,
    () => openQuickAskFromClipboard(),
    api,
    'selection'
  );

  mainAppState.quickAskSelectionShortcutRegistered = selectionResult.ok;
  if (selectionResult.ok) {
    mainAppState.quickAskSelectionShortcutError = null;
    log('[QuickAsk] Selection shortcut registered:', selectionResult.accelerator);
  } else {
    mainAppState.quickAskSelectionShortcutError = registrationErrorMessage(selectionResult);
    logWarn(
      '[QuickAsk] Selection shortcut registration failed:',
      mainAppState.quickAskSelectionShortcutError,
      selectionResult.accelerator
    );
  }

  broadcastStatus();
  return { ask: askResult, selection: selectionResult };
}

/** Unregister shortcuts and destroy window — call on app quit. */
export function shutdownQuickAsk(): void {
  unregisterAllQuickAskShortcuts(shortcutApi());
  mainAppState.quickAskShortcutRegistered = false;
  mainAppState.quickAskSelectionShortcutRegistered = false;
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
  const folders = safeListChatFolders(getDatabase());
  sendToRenderer({ type: 'session.list', payload: { sessions, folders } });

  sendToRenderer({
    type: 'navigate.to',
    payload: { page: 'session', sessionId: id },
  });
}
