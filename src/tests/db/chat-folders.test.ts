import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  assignSessionToFolder,
  createChatFolder,
  deleteChatFolder,
  listChatFolders,
} from '../../main/session/chat-folders-store';
import {
  setSessionParentId,
  wouldCreateSessionParentCycle,
} from '../../main/session/session-parent-cycle';
import type { DatabaseInstance, SessionRow } from '../../main/db/database';

const userDataRoot = path.join(
  os.tmpdir(),
  `lygodactylus-chat-folders-test-${process.pid}-${Date.now()}`
);

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataRoot;
      return path.join(os.tmpdir(), name);
    },
  },
}));

vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

function createLegacySessionsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      claude_session_id TEXT,
      openai_thread_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      cwd TEXT,
      mounted_paths TEXT NOT NULL DEFAULT '[]',
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      memory_enabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

function wrapRawAsDatabaseInstance(raw: Database.Database): DatabaseInstance {
  return {
    raw,
    sessions: {
      create: vi.fn(),
      update: (id, updates) => {
        const setClauses: string[] = [];
        const values: unknown[] = [];
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            setClauses.push(`${key} = ?`);
            values.push(value);
          }
        }
        if (setClauses.length === 0) return;
        setClauses.push('updated_at = ?');
        values.push(Date.now());
        values.push(id);
        raw.prepare(`UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
      },
      get: (id) =>
        raw.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined,
      getAll: () => raw.prepare('SELECT * FROM sessions').all() as SessionRow[],
      delete: vi.fn(),
    },
    folders: {
      create: (folder) => {
        raw
          .prepare(
            'INSERT INTO folders (id, name, collapsed, position, created_at) VALUES (?, ?, ?, ?, ?)'
          )
          .run(folder.id, folder.name, folder.collapsed, folder.position, folder.created_at);
      },
      update: (id, updates) => {
        const setClauses: string[] = [];
        const values: unknown[] = [];
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined && key !== 'id' && key !== 'created_at') {
            setClauses.push(`${key} = ?`);
            values.push(value);
          }
        }
        if (setClauses.length === 0) return;
        values.push(id);
        raw.prepare(`UPDATE folders SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
      },
      get: (id) =>
        raw.prepare('SELECT * FROM folders WHERE id = ?').get(id) as
          | { id: string; name: string; collapsed: number; position: number; created_at: number }
          | undefined,
      getAll: () =>
        raw
          .prepare('SELECT * FROM folders ORDER BY position ASC, created_at ASC')
          .all() as Array<{
          id: string;
          name: string;
          collapsed: number;
          position: number;
          created_at: number;
        }>,
      delete: (id) => {
        raw.prepare('DELETE FROM folders WHERE id = ?').run(id);
      },
      clearSessionFolderRefs: (folderId) => {
        raw
          .prepare('UPDATE sessions SET folder_id = NULL, updated_at = ? WHERE folder_id = ?')
          .run(Date.now(), folderId);
      },
    },
    messages: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
      deleteFromTimestamp: vi.fn(),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
      deleteFromTimestamp: vi.fn(),
    },
    scheduledTasks: {
      create: vi.fn(),
      update: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn(() => []),
      delete: vi.fn(),
    },
    prepare: (sql) => raw.prepare(sql),
    exec: (sql) => raw.exec(sql),
    pragma: (pragma) => raw.pragma(pragma),
    close: () => raw.close(),
  };
}

describe('chat folders + session parent columns', () => {
  let rawDb: Database.Database;
  let db: DatabaseInstance;

  beforeEach(() => {
    fs.rmSync(userDataRoot, { recursive: true, force: true });
    fs.mkdirSync(userDataRoot, { recursive: true });
    rawDb = new Database(':memory:');
    createLegacySessionsTable(rawDb);
    // Simulate additive ensureColumn migrations on an existing DB.
    rawDb.exec(`ALTER TABLE sessions ADD COLUMN folder_id TEXT`);
    rawDb.exec(`ALTER TABLE sessions ADD COLUMN parent_session_id TEXT`);
    rawDb.exec(`
      CREATE TABLE folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        collapsed INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);
    rawDb
      .prepare(
        `
      INSERT INTO sessions (
        id, title, status, mounted_paths, allowed_tools, memory_enabled, created_at, updated_at
      ) VALUES (?, ?, 'idle', '[]', '[]', 0, 1, 1)
    `
      )
      .run('s1', 'Alpha');
    rawDb
      .prepare(
        `
      INSERT INTO sessions (
        id, title, status, mounted_paths, allowed_tools, memory_enabled, created_at, updated_at
      ) VALUES (?, ?, 'idle', '[]', '[]', 0, 2, 2)
    `
      )
      .run('s2', 'Beta');
    db = wrapRawAsDatabaseInstance(rawDb);
  });

  afterEach(() => {
    rawDb.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  });

  it('adds nullable folder_id and parent_session_id on existing rows', () => {
    const row = rawDb.prepare('SELECT folder_id, parent_session_id FROM sessions WHERE id = ?').get(
      's1'
    ) as { folder_id: string | null; parent_session_id: string | null };
    expect(row.folder_id).toBeNull();
    expect(row.parent_session_id).toBeNull();
  });

  it('orphans sessions to root when a folder is deleted (never deletes sessions)', () => {
    const folder = createChatFolder(db, { name: 'Project' });
    assignSessionToFolder(db, { sessionId: 's1', folderId: folder.id });
    assignSessionToFolder(db, { sessionId: 's2', folderId: folder.id });

    expect(db.sessions.get('s1')?.folder_id).toBe(folder.id);
    expect(deleteChatFolder(db, folder.id)).toBe(true);
    expect(listChatFolders(db)).toEqual([]);
    expect(db.sessions.get('s1')?.folder_id).toBeNull();
    expect(db.sessions.get('s2')?.folder_id).toBeNull();
    expect(db.sessions.getAll()).toHaveLength(2);
  });

  it('forbids parent cycles (a parent cannot become a child of its child)', () => {
    setSessionParentId(db, 's2', 's1');
    expect(wouldCreateSessionParentCycle(db, 's1', 's2')).toBe(true);
    const blocked = setSessionParentId(db, 's1', 's2');
    expect(blocked.success).toBe(false);
    expect(blocked.errorKey).toBe('errSessionParentCycle');
    expect(db.sessions.get('s1')?.parent_session_id).toBeNull();
  });
});

describe('initDatabase additive folders schema', () => {
  beforeEach(() => {
    vi.resetModules();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
    fs.mkdirSync(userDataRoot, { recursive: true });
  });

  afterEach(async () => {
    const { closeDatabase } = await import('../../main/db/database');
    closeDatabase();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  });

  it('creates folders table and session columns on fresh init', async () => {
    const { initDatabase, closeDatabase } = await import('../../main/db/database');
    const instance = initDatabase();
    const columns = instance.raw
      .prepare('PRAGMA table_info(sessions)')
      .all() as Array<{ name: string }>;
    const names = new Set(columns.map((c) => c.name));
    expect(names.has('folder_id')).toBe(true);
    expect(names.has('parent_session_id')).toBe(true);

    const foldersTable = instance.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='folders'")
      .get() as { name: string } | undefined;
    expect(foldersTable?.name).toBe('folders');

    closeDatabase();
  });
});
