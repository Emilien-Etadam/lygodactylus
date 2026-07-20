/**
 * @module main/quick-ask/quick-ask-window
 *
 * Frameless always-on-top Quick Ask BrowserWindow (same preload as main).
 */
import { BrowserWindow, screen } from 'electron';
import { join } from 'path';
import type { QuickAskOpenedPayload } from '../../shared/quick-ask';
import { configStore } from '../config/config-store';
import { log, logError, logWarn } from '../utils/logger';
import { mainAppState } from '../main-app-state';
import { getSavedThemePreference, resolveEffectiveTheme } from '../main-app-window';

const DEFAULT_OPENED_PAYLOAD: QuickAskOpenedPayload = {
  mode: 'ask',
  sourceText: '',
  truncated: false,
  empty: false,
};

const QUICK_ASK_WIDTH = 640;
const QUICK_ASK_HEIGHT = 420;

const WINDOW_BACKGROUNDS = {
  dark: '#1e1e1e',
  light: '#ffffff',
} as const;

function resolvePreloadPath(): string {
  return join(__dirname, '../preload/index.js');
}

function buildQuickAskLoadTarget(): { kind: 'url'; url: string } | { kind: 'file'; file: string } {
  if (process.env.VITE_DEV_SERVER_URL) {
    const base = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '');
    return { kind: 'url', url: `${base}/?view=quick-ask` };
  }
  return { kind: 'file', file: join(__dirname, '../../dist/index.html') };
}

function centerBounds(): { x: number; y: number; width: number; height: number } {
  const display = screen.getPrimaryDisplay();
  const { width: areaW, height: areaH, x: areaX, y: areaY } = display.workArea;
  return {
    width: QUICK_ASK_WIDTH,
    height: QUICK_ASK_HEIGHT,
    x: Math.round(areaX + (areaW - QUICK_ASK_WIDTH) / 2),
    y: Math.round(areaY + (areaH - QUICK_ASK_HEIGHT) / 2),
  };
}

function attachBlurHide(win: BrowserWindow): void {
  win.on('blur', () => {
    if (mainAppState.isCleaningUp) {
      return;
    }
    if (!win.isDestroyed() && win.isVisible()) {
      win.hide();
    }
  });
}

export function createQuickAskWindow(): BrowserWindow {
  if (mainAppState.quickAskWindow && !mainAppState.quickAskWindow.isDestroyed()) {
    return mainAppState.quickAskWindow;
  }

  const effectiveTheme = resolveEffectiveTheme(getSavedThemePreference());
  const background = WINDOW_BACKGROUNDS[effectiveTheme];
  const bounds = centerBounds();

  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: background,
    webPreferences: {
      preload: resolvePreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  attachBlurHide(win);

  win.on('closed', () => {
    if (mainAppState.quickAskWindow === win) {
      mainAppState.quickAskWindow = null;
    }
  });

  const target = buildQuickAskLoadTarget();
  void (async () => {
    try {
      if (target.kind === 'url') {
        await win.loadURL(target.url);
      } else {
        await win.loadFile(target.file, { query: { view: 'quick-ask' } });
      }
    } catch (error) {
      logError('[QuickAsk] Failed to load window URL:', error);
    }
  })();

  mainAppState.quickAskWindow = win;
  log('[QuickAsk] Window created');
  return win;
}

export function hideQuickAskWindow(): void {
  const win = mainAppState.quickAskWindow;
  if (win && !win.isDestroyed() && win.isVisible()) {
    win.hide();
  }
}

function sendOpenedEvent(win: BrowserWindow, payload: QuickAskOpenedPayload): void {
  const event = { type: 'quickAsk.opened' as const, payload };
  if (!win.webContents.isLoading()) {
    win.webContents.send('server-event', event);
  } else {
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) {
        win.webContents.send('server-event', event);
      }
    });
  }
}

export function showQuickAskWindow(
  opened: QuickAskOpenedPayload = DEFAULT_OPENED_PAYLOAD
): void {
  if (!configStore.get('quickAskEnabled')) {
    logWarn('[QuickAsk] show requested while feature disabled');
    return;
  }

  const win = createQuickAskWindow();
  if (win.isDestroyed()) {
    return;
  }

  const bounds = centerBounds();
  win.setBounds(bounds);
  win.show();
  win.focus();
  sendOpenedEvent(win, opened);
}

/** Toggle visibility — used by the Ask global shortcut. */
export function toggleQuickAskWindow(): void {
  if (!configStore.get('quickAskEnabled')) {
    return;
  }

  const win = mainAppState.quickAskWindow;
  if (win && !win.isDestroyed() && win.isVisible()) {
    win.hide();
    return;
  }
  showQuickAskWindow(DEFAULT_OPENED_PAYLOAD);
}

/**
 * Always show (never toggle-hide) in Sélection mode with the given clipboard payload.
 */
export function showQuickAskSelectionWindow(opened: QuickAskOpenedPayload): void {
  showQuickAskWindow({ ...opened, mode: 'selection' });
}

export function destroyQuickAskWindow(): void {
  const win = mainAppState.quickAskWindow;
  if (win && !win.isDestroyed()) {
    win.destroy();
  }
  mainAppState.quickAskWindow = null;
}
