/**
 * @module main/ipc/ipc-chat-folders
 *
 * Desktop invoke CRUD for sidebar chat folders (not on client-event-allowlist).
 * Remote /app/ displays groups via enriched session.list only.
 */
import { ipcMain } from 'electron';
import type {
  ChatFolderAssignInput,
  ChatFolderCreateInput,
  ChatFolderUpdateInput,
} from '../../shared/chat-folders';
import { getDatabase } from '../db/database';
import {
  assignSessionToFolder,
  createChatFolder,
  deleteChatFolder,
  listChatFolders,
  safeListChatFolders,
  updateChatFolder,
} from '../session/chat-folders-store';
import { mainAppState } from '../main-app-state';
import { sendToRenderer } from '../main-renderer-bridge';
import { logError } from '../utils/logger';

function emitSessionListRefresh(): void {
  const sm = mainAppState.sessionManager;
  if (!sm) return;
  const sessions = sm.listSessions();
  const folders = safeListChatFolders(getDatabase());
  sendToRenderer({
    type: 'session.list',
    payload: { sessions, folders },
  });
}

export function registerChatFoldersIpc(): void {
  ipcMain.handle('folder.list', () => {
    try {
      return listChatFolders(getDatabase());
    } catch (error) {
      logError('[ChatFolders] Error listing folders:', error);
      return [];
    }
  });

  ipcMain.handle('folder.create', (_event, payload: ChatFolderCreateInput) => {
    try {
      const folder = createChatFolder(getDatabase(), payload);
      emitSessionListRefresh();
      return folder;
    } catch (error) {
      logError('[ChatFolders] Error creating folder:', error);
      throw error instanceof Error ? error : new Error('Failed to create folder');
    }
  });

  ipcMain.handle(
    'folder.update',
    (_event, id: string, updates: ChatFolderUpdateInput) => {
      try {
        const folder = updateChatFolder(getDatabase(), id, updates);
        emitSessionListRefresh();
        return folder;
      } catch (error) {
        logError('[ChatFolders] Error updating folder:', error);
        throw error instanceof Error ? error : new Error('Failed to update folder');
      }
    }
  );

  ipcMain.handle('folder.delete', (_event, id: string) => {
    try {
      const success = deleteChatFolder(getDatabase(), id);
      if (success) {
        emitSessionListRefresh();
      }
      return { success };
    } catch (error) {
      logError('[ChatFolders] Error deleting folder:', error);
      return { success: false };
    }
  });

  ipcMain.handle('folder.assign', (_event, payload: ChatFolderAssignInput) => {
    try {
      const result = assignSessionToFolder(getDatabase(), payload);
      if (result.success) {
        emitSessionListRefresh();
      }
      return result;
    } catch (error) {
      logError('[ChatFolders] Error assigning session:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
