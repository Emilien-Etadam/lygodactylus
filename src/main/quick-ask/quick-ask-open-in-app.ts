/**
 * @module main/quick-ask/quick-ask-open-in-app
 *
 * Focus / recreate the main window when opening a Quick Ask session in-app.
 */
import { BrowserWindow } from 'electron';
import { mainAppState } from '../main-app-state';
import { createWindow } from '../main-app-window';

export function ensureMainWindowVisible(): void {
  let win =
    mainAppState.mainWindow && !mainAppState.mainWindow.isDestroyed()
      ? mainAppState.mainWindow
      : null;

  if (!win) {
    const existing = BrowserWindow.getAllWindows().find(
      (candidate) =>
        !candidate.isDestroyed() && candidate !== mainAppState.quickAskWindow
    );
    if (existing) {
      mainAppState.mainWindow = existing;
      win = existing;
    } else {
      createWindow();
      win =
        mainAppState.mainWindow && !mainAppState.mainWindow.isDestroyed()
          ? mainAppState.mainWindow
          : null;
    }
  }

  if (!win) {
    return;
  }

  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
}
