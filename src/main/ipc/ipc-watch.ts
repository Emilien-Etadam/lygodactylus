/**
 * @module main/ipc/ipc-watch
 *
 * Desktop-only CRUD for content-watch (Veille) watchers.
 * Not on client-event-allowlist / LAN RPC.
 */
import { ipcMain } from 'electron';
import type { WatcherCreateInput, WatcherUpdateInput } from '../../shared/watch';
import { mainAppState } from '../main-app-state';
import { logError } from '../utils/logger';

export function registerWatchIpc(): void {
  ipcMain.handle('watch.list', () => {
    try {
      if (!mainAppState.watchManager) return [];
      return mainAppState.watchManager.list();
    } catch (error) {
      logError('[Veille] Error listing watchers:', error);
      return [];
    }
  });

  ipcMain.handle('watch.create', (_event, payload: WatcherCreateInput) => {
    if (!mainAppState.watchManager) {
      throw new Error('Watch manager not initialized');
    }
    try {
      return mainAppState.watchManager.create(payload);
    } catch (error) {
      logError('[Veille] Error creating watcher:', error);
      throw error instanceof Error ? error : new Error('Failed to create watcher');
    }
  });

  ipcMain.handle('watch.update', (_event, id: string, updates: WatcherUpdateInput) => {
    if (!mainAppState.watchManager) {
      throw new Error('Watch manager not initialized');
    }
    try {
      return mainAppState.watchManager.update(id, updates);
    } catch (error) {
      logError('[Veille] Error updating watcher:', error);
      throw error instanceof Error ? error : new Error('Failed to update watcher');
    }
  });

  ipcMain.handle('watch.delete', (_event, id: string) => {
    if (!mainAppState.watchManager) {
      throw new Error('Watch manager not initialized');
    }
    return { success: mainAppState.watchManager.delete(id) };
  });

  ipcMain.handle('watch.toggle', (_event, id: string, enabled: boolean) => {
    if (!mainAppState.watchManager) {
      throw new Error('Watch manager not initialized');
    }
    try {
      return mainAppState.watchManager.toggle(id, enabled);
    } catch (error) {
      logError('[Veille] Error toggling watcher:', error);
      throw error instanceof Error ? error : new Error('Failed to toggle watcher');
    }
  });

  ipcMain.handle('watch.runNow', async (_event, id: string) => {
    if (!mainAppState.watchManager) {
      throw new Error('Watch manager not initialized');
    }
    return mainAppState.watchManager.runNow(id);
  });
}
