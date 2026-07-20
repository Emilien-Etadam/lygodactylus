/**
 * @module main/ipc/ipc-prompt-presets
 *
 * Invoke-based CRUD for local prompt presets (not on client-event-allowlist).
 */
import { ipcMain } from 'electron';
import { promptPresetsStore } from '../prompt-presets/prompt-presets-store';
import { logError } from '../utils/logger';
import type {
  PromptPresetCreateInput,
  PromptPresetUpdateInput,
} from '../../shared/prompt-presets';

export function registerPromptPresetsIpc(): void {
  ipcMain.handle('presets.list', () => {
    try {
      return promptPresetsStore.list();
    } catch (error) {
      logError('[PromptPresets] Error listing presets:', error);
      return [];
    }
  });

  ipcMain.handle('presets.get', (_event, id: string) => {
    try {
      return promptPresetsStore.get(id) ?? null;
    } catch (error) {
      logError('[PromptPresets] Error getting preset:', error);
      return null;
    }
  });

  ipcMain.handle('presets.getByName', (_event, name: string) => {
    try {
      return promptPresetsStore.getByName(name) ?? null;
    } catch (error) {
      logError('[PromptPresets] Error getting preset by name:', error);
      return null;
    }
  });

  ipcMain.handle('presets.create', (_event, payload: PromptPresetCreateInput) => {
    try {
      return promptPresetsStore.create(payload);
    } catch (error) {
      logError('[PromptPresets] Error creating preset:', error);
      throw error instanceof Error ? error : new Error('Failed to create preset');
    }
  });

  ipcMain.handle(
    'presets.update',
    (_event, id: string, updates: PromptPresetUpdateInput) => {
      try {
        return promptPresetsStore.update(id, updates);
      } catch (error) {
        logError('[PromptPresets] Error updating preset:', error);
        throw error instanceof Error ? error : new Error('Failed to update preset');
      }
    }
  );

  ipcMain.handle('presets.delete', (_event, id: string) => {
    try {
      return { success: promptPresetsStore.delete(id) };
    } catch (error) {
      logError('[PromptPresets] Error deleting preset:', error);
      return { success: false };
    }
  });
}
