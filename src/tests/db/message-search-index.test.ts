import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MessageSearchIndex,
  escapeFts5Query,
  extractIndexableMessageText,
  probeFts5Available,
} from '../../main/db/message-search-index';

function createBaseSchema(db: Database.Database): void {
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
      mode TEXT NOT NULL DEFAULT 'act',
      model TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      token_usage TEXT,
      execution_time_ms INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);
}

function insertSession(
  db: Database.Database,
  id: string,
  title: string,
  createdAt = 1000
): void {
  db.prepare(
    `
    INSERT INTO sessions (
      id, title, status, mounted_paths, allowed_tools, memory_enabled, mode,
      created_at, updated_at
    ) VALUES (?, ?, 'idle', '[]', '[]', 0, 'act', ?, ?)
  `
  ).run(id, title, createdAt, createdAt);
}

function insertMessage(
  db: Database.Database,
  payload: {
    id: string;
    sessionId: string;
    role: string;
    content: unknown;
    timestamp: number;
  }
): void {
  db.prepare(
    `
    INSERT INTO messages (id, session_id, role, content, timestamp, token_usage, execution_time_ms)
    VALUES (?, ?, ?, ?, ?, NULL, NULL)
  `
  ).run(
    payload.id,
    payload.sessionId,
    payload.role,
    JSON.stringify(payload.content),
    payload.timestamp
  );
}

describe('MessageSearchIndex', () => {
  let db: Database.Database;
  let index: MessageSearchIndex;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createBaseSchema(db);
    index = new MessageSearchIndex(db);
    index.ensureSchema();
  });

  afterEach(() => {
    db.close();
  });

  it('reports FTS5 as available in the embedded better-sqlite3 build', () => {
    expect(probeFts5Available(db)).toBe(true);
    expect(index.ftsAvailable).toBe(true);
  });

  it('indexes inserted messages and finds them; delete removes them', () => {
    insertSession(db, 's1', 'Alpha project');
    index.upsertSessionTitle('s1', 'Alpha project');

    const content = [{ type: 'text', text: 'Deploy the canary build tonight' }];
    insertMessage(db, {
      id: 'm1',
      sessionId: 's1',
      role: 'user',
      content,
      timestamp: 2000,
    });
    index.upsertMessage({
      id: 'm1',
      session_id: 's1',
      role: 'user',
      content: JSON.stringify(content),
      timestamp: 2000,
    });

    const found = index.search('canary');
    expect(found.some((hit) => hit.messageId === 'm1')).toBe(true);
    expect(found[0]?.sessionTitle).toBe('Alpha project');

    index.removeMessage('m1');
    db.prepare('DELETE FROM messages WHERE id = ?').run('m1');

    const afterDelete = index.search('canary');
    expect(afterDelete.some((hit) => hit.messageId === 'm1')).toBe(false);
  });

  it('indexes session titles and ignores tool_use / tool_result blocks', () => {
    insertSession(db, 's2', 'UniqueZebraTitle');
    index.upsertSessionTitle('s2', 'UniqueZebraTitle');

    const toolOnly = [
      { type: 'tool_use', id: 't1', name: 'bash', input: { command: 'UniqueZebraTitle' } },
      { type: 'tool_result', toolUseId: 't1', content: 'UniqueZebraTitle output' },
    ];
    insertMessage(db, {
      id: 'm-tool',
      sessionId: 's2',
      role: 'assistant',
      content: toolOnly,
      timestamp: 3000,
    });
    index.upsertMessage({
      id: 'm-tool',
      session_id: 's2',
      role: 'assistant',
      content: JSON.stringify(toolOnly),
      timestamp: 3000,
    });

    const titleHits = index.search('UniqueZebraTitle');
    expect(titleHits.some((hit) => hit.messageId === null && hit.sessionId === 's2')).toBe(true);
    expect(titleHits.some((hit) => hit.messageId === 'm-tool')).toBe(false);

    expect(extractIndexableMessageText('assistant', JSON.stringify(toolOnly))).toBeNull();
  });

  it('backfill is idempotent and skips non-indexable messages without looping', () => {
    insertSession(db, 's3', 'Backfill Session');
    insertMessage(db, {
      id: 'm-text',
      sessionId: 's3',
      role: 'user',
      content: [{ type: 'text', text: 'idempotent pineapple search' }],
      timestamp: 4000,
    });
    insertMessage(db, {
      id: 'm-empty',
      sessionId: 's3',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'x', name: 'read', input: {} }],
      timestamp: 4001,
    });

    expect(index.backfillChunk(10)).toBe(false);
    const countAfterFirst = index.getIndexedCount();
    expect(countAfterFirst).toBeGreaterThan(0);
    expect(index.search('pineapple').some((hit) => hit.messageId === 'm-text')).toBe(true);

    expect(index.backfillChunk(10)).toBe(false);
    expect(index.getIndexedCount()).toBe(countAfterFirst);
  });

  it('escapes FTS special characters in user queries', () => {
    insertSession(db, 's4', 'Operators');
    index.upsertSessionTitle('s4', 'Operators');
    const content = [{ type: 'text', text: 'literal AND OR NOT caret^ star* colon: value' }];
    insertMessage(db, {
      id: 'm-ops',
      sessionId: 's4',
      role: 'user',
      content,
      timestamp: 5000,
    });
    index.upsertMessage({
      id: 'm-ops',
      session_id: 's4',
      role: 'user',
      content: JSON.stringify(content),
      timestamp: 5000,
    });

    const escaped = escapeFts5Query('AND OR "quote" caret^');
    expect(escaped).toContain('"AND"*');
    expect(escaped).toContain('"OR"*');
    expect(escaped).toContain('""'); // escaped quote inside token
    expect(() => index.search('AND OR caret^ star*')).not.toThrow();
    expect(index.search('literal').some((hit) => hit.messageId === 'm-ops')).toBe(true);
  });

  it('removeFromTimestamp keeps the title document', () => {
    insertSession(db, 's5', 'Rewindable');
    index.upsertSessionTitle('s5', 'Rewindable');
    insertMessage(db, {
      id: 'm-old',
      sessionId: 's5',
      role: 'user',
      content: [{ type: 'text', text: 'keep me' }],
      timestamp: 100,
    });
    index.upsertMessage({
      id: 'm-old',
      session_id: 's5',
      role: 'user',
      content: JSON.stringify([{ type: 'text', text: 'keep me' }]),
      timestamp: 100,
    });
    insertMessage(db, {
      id: 'm-new',
      sessionId: 's5',
      role: 'user',
      content: [{ type: 'text', text: 'drop me' }],
      timestamp: 200,
    });
    index.upsertMessage({
      id: 'm-new',
      session_id: 's5',
      role: 'user',
      content: JSON.stringify([{ type: 'text', text: 'drop me' }]),
      timestamp: 200,
    });

    index.removeFromTimestamp('s5', 200);
    expect(index.search('drop').some((hit) => hit.messageId === 'm-new')).toBe(false);
    expect(index.search('keep').some((hit) => hit.messageId === 'm-old')).toBe(true);
    expect(index.search('Rewindable').some((hit) => hit.sessionId === 's5')).toBe(true);
  });
});
