/**
 * Sidebar chat folders (project groups) — local SQLite, desktop CRUD.
 * Remote /app/ receives folders via enriched session.list (no dedicated channel).
 */

export interface ChatFolder {
  id: string;
  name: string;
  collapsed: boolean;
  position: number;
  createdAt: number;
}

export interface ChatFolderCreateInput {
  name: string;
}

export interface ChatFolderUpdateInput {
  name?: string;
  collapsed?: boolean;
  position?: number;
}

export interface ChatFolderAssignInput {
  sessionId: string;
  folderId: string | null;
}
