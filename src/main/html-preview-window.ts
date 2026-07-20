/**
 * Dedicated HTML/SVG preview window — no preload, no nodeIntegration.
 * Loads CSP-hardened srcdoc content with opaque data: origin isolation.
 */
import { BrowserWindow } from 'electron';
import { logError } from './utils/logger';
import { mainAppState } from './main-app-state';
import { isValidPreviewSrcdoc } from '../shared/html-preview';

function closeExistingPreviewWindow(): void {
  const existing = mainAppState.htmlPreviewWindow;
  if (existing && !existing.isDestroyed()) {
    existing.close();
  }
  mainAppState.htmlPreviewWindow = null;
}

/**
 * Open (or replace) a sandboxed preview window for the given srcdoc HTML.
 * Returns false when the payload is rejected.
 */
export function openHtmlPreviewWindow(srcdoc: string): boolean {
  if (!isValidPreviewSrcdoc(srcdoc)) {
    logError('[HtmlPreview] Rejected invalid or oversized srcdoc');
    return false;
  }

  try {
    closeExistingPreviewWindow();

    const win = new BrowserWindow({
      width: 960,
      height: 720,
      minWidth: 480,
      minHeight: 320,
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        // Intentionally no preload — preview must not see electronAPI.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });

    win.on('closed', () => {
      if (mainAppState.htmlPreviewWindow === win) {
        mainAppState.htmlPreviewWindow = null;
      }
    });

    const dataUrl = `data:text/html;charset=utf-8;base64,${Buffer.from(srcdoc, 'utf8').toString('base64')}`;
    void win
      .loadURL(dataUrl)
      .then(() => {
        if (!win.isDestroyed()) {
          win.show();
        }
      })
      .catch((error: Error) => {
        logError('[HtmlPreview] Failed to load preview window:', error);
        if (!win.isDestroyed()) {
          win.close();
        }
      });

    mainAppState.htmlPreviewWindow = win;
    return true;
  } catch (error) {
    logError('[HtmlPreview] Failed to open preview window:', error);
    return false;
  }
}
