/**
 * @module main/session/chat-folders-store
 *
 * CRUD for sidebar chat folders + session folder assignment.
 * Desktop-only mutations; list is also exposed via enriched session.list.
 */
import { randomUUID } from 'node:crypto';
import type {
  ChatFolder,
  ChatFolderAssignInput,
  ChatFolderCreateInput,
  ChatFolderUpdateInput,
} from '../../shared/chat-folders';
import type { DatabaseInstance, FolderRow } from '../db/database';
import { logError } from '../utils/logger';

function mapFolderRow(row: FolderRow): ChatFolder {
  return {
    id: row.id,
    name: row.name,
    collapsed: row.collapsed === 1,
    position: row.position,
    createdAt: row.created_at,
  };
}

function normalizeFolderName(name: string): string {
  return name.trim();
}

export function listChatFolders(db: DatabaseInstance): ChatFolder[] {
  return db.folders.getAll().map(mapFolderRow);
}

export function createChatFolder(
  db: DatabaseInstance,
  input: ChatFolderCreateInput
): ChatFolder {
  const name = normalizeFolderName(input.name);
  if (!name) {
    throw new Error('Folder name is required');
  }

  const existing = db.folders.getAll();
  const maxPosition = existing.reduce((max, row) => Math.max(max, row.position), -1);
  const folder: FolderRow = {
    id: randomUUID(),
    name,
    collapsed: 0,
    position: maxPosition + 1,
    created_at: Date.now(),
  };

  db.folders.create(folder);
  return mapFolderRow(folder);
}

export function updateChatFolder(
  db: DatabaseInstance,
  id: string,
  updates: ChatFolderUpdateInput
): ChatFolder | null {
  const existing = db.folders.get(id);
  if (!existing) {
    return null;
  }

  const rowUpdates: Partial<FolderRow> = {};
  if (updates.name !== undefined) {
    const name = normalizeFolderName(updates.name);
    if (!name) {
      throw new Error('Folder name is required');
    }
    rowUpdates.name = name;
  }
  if (updates.collapsed !== undefined) {
    rowUpdates.collapsed = updates.collapsed ? 1 : 0;
  }
  if (updates.position !== undefined) {
    if (!Number.isFinite(updates.position)) {
      throw new Error('Invalid folder position');
    }
    rowUpdates.position = Math.trunc(updates.position);
  }

  db.folders.update(id, rowUpdates);
  const updated = db.folders.get(id);
  return updated ? mapFolderRow(updated) : null;
}

/**
 * Delete a folder and orphan its sessions to the root (folder_id → NULL).
 * Sessions themselves are never deleted.
 */
export function deleteChatFolder(db: DatabaseInstance, id: string): boolean {
  const existing = db.folders.get(id);
  if (!existing) {
    return false;
  }
  db.folders.clearSessionFolderRefs(id);
  db.folders.delete(id);
  return true;
}

export function assignSessionToFolder(
  db: DatabaseInstance,
  input: ChatFolderAssignInput
): { success: boolean; error?: string } {
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
  if (!sessionId) {
    return { success: false, error: 'sessionId is required' };
  }

  const session = db.sessions.get(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  const folderId =
    input.folderId === null || input.folderId === undefined
      ? null
      : String(input.folderId).trim() || null;

  if (folderId) {
    const folder = db.folders.get(folderId);
    if (!folder) {
      return { success: false, error: 'Folder not found' };
    }
  }

  try {
    db.sessions.update(sessionId, { folder_id: folderId });
    return { success: true };
  } catch (error) {
    logError('[ChatFolders] assign failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
