/**
 * Full-text search index for conversation titles and message bodies.
 *
 * Uses SQLite FTS5 when available in the embedded better-sqlite3 build.
 * If FTS5 is missing, search falls back to LIKE + JS text extraction against
 * the source tables (messages / sessions). Sync hooks are then no-ops because
 * the messages table remains the single source of truth.
 */

import type Database from 'better-sqlite3';
import type { SessionMessageSearchHit } from '../../shared/session-message-search';
import { log, logError, logWarn } from '../utils/logger';

export type { SessionMessageSearchHit };

export const MESSAGE_SEARCH_TITLE_DOC_PREFIX = 't:';

interface FtsRow {
  message_id: string;
  session_id: string;
  role: string;
  timestamp: number;
  session_title: string;
  body: string;
}

interface MessageScanRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  timestamp: number;
  title: string;
}

const FTS_TABLE = 'messages_fts';
const BACKFILL_META_TABLE = 'messages_fts_meta';
const INDEXED_STATE_TABLE = 'messages_fts_indexed';
const DEFAULT_SEARCH_LIMIT = 40;
const DEFAULT_BACKFILL_CHUNK = 80;
const EXCERPT_RADIUS = 72;

export function probeFts5Available(database: Database.Database): boolean {
  try {
    database.exec('CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_probe USING fts5(x)');
    database.exec('DROP TABLE IF EXISTS _fts5_probe');
    return true;
  } catch {
    return false;
  }
}

/** Escape a user query into a safe FTS5 MATCH expression (AND of prefix tokens). */
export function escapeFts5Query(query: string): string {
  const tokens = query
    .trim()
    .split(/\s+/u)
    .map((token) => token.replace(/"/g, '""'))
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return '';
  }

  // Quoted tokens neutralize FTS operators (AND/OR/NOT, :, *, ^, parentheses…).
  // Trailing * enables prefix matching for partial words.
  return tokens.map((token) => `"${token}"*`).join(' AND ');
}

export function extractIndexableMessageText(role: string, contentJson: string): string | null {
  if (role !== 'user' && role !== 'assistant') {
    return null;
  }

  const texts: string[] = [];
  try {
    const parsed: unknown = JSON.parse(contentJson);
    collectTextBlocks(parsed, texts);
  } catch {
    const trimmed = contentJson.trim();
    if (trimmed) {
      texts.push(trimmed);
    }
  }

  const joined = texts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n')
    .trim();

  return joined.length > 0 ? joined : null;
}

function collectTextBlocks(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextBlocks(item, out);
    }
    return;
  }

  if (typeof value !== 'object' || value === null) {
    if (typeof value === 'string' && value.trim()) {
      out.push(value);
    }
    return;
  }

  const block = value as { type?: unknown; text?: unknown };
  if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
    out.push(block.text);
  }
}

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();
}

export function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

export function buildHighlightedExcerpt(
  text: string,
  query: string,
  radius = EXCERPT_RADIUS
): { excerpt: string; highlights: Array<[number, number]> } {
  const normalizedText = text.replace(/\s+/gu, ' ').trim();
  if (!normalizedText) {
    return { excerpt: '', highlights: [] };
  }

  const terms = query
    .trim()
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);

  if (terms.length === 0) {
    const excerpt = normalizedText.slice(0, radius * 2);
    return { excerpt, highlights: [] };
  }

  const lowerText = normalizedText.toLowerCase();
  let firstMatch = -1;
  let firstLen = 0;
  for (const term of terms) {
    const idx = lowerText.indexOf(term.toLowerCase());
    if (idx >= 0 && (firstMatch < 0 || idx < firstMatch)) {
      firstMatch = idx;
      firstLen = term.length;
    }
  }

  const start =
    firstMatch >= 0 ? Math.max(0, firstMatch - radius) : 0;
  const end =
    firstMatch >= 0
      ? Math.min(normalizedText.length, firstMatch + firstLen + radius)
      : Math.min(normalizedText.length, radius * 2);

  const prefix = start > 0 ? '…' : '';
  const suffix = end < normalizedText.length ? '…' : '';
  const excerptCore = normalizedText.slice(start, end);
  const excerpt = `${prefix}${excerptCore}${suffix}`;

  const highlights: Array<[number, number]> = [];
  const lowerExcerpt = excerpt.toLowerCase();
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    let from = 0;
    while (from < lowerExcerpt.length) {
      const idx = lowerExcerpt.indexOf(needle, from);
      if (idx < 0) break;
      highlights.push([idx, idx + needle.length]);
      from = idx + needle.length;
    }
  }

  highlights.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { excerpt, highlights: mergeRanges(highlights) };
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length === 0) return [];
  const merged: Array<[number, number]> = [ranges[0]];
  for (let i = 1; i < ranges.length; i += 1) {
    const current = ranges[i];
    const last = merged[merged.length - 1];
    if (current[0] <= last[1]) {
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

function titleDocId(sessionId: string): string {
  return `${MESSAGE_SEARCH_TITLE_DOC_PREFIX}${sessionId}`;
}

function isTitleDocId(messageId: string): boolean {
  return messageId.startsWith(MESSAGE_SEARCH_TITLE_DOC_PREFIX);
}

export class MessageSearchIndex {
  readonly ftsAvailable: boolean;

  private backfillRunning = false;
  private insertFtsStmt: Database.Statement | null = null;
  private deleteFtsByMessageStmt: Database.Statement | null = null;
  private deleteFtsBySessionStmt: Database.Statement | null = null;
  private deleteFtsSessionMessagesStmt: Database.Statement | null = null;
  private deleteFtsFromTimestampStmt: Database.Statement | null = null;
  private updateFtsTitleStmt: Database.Statement | null = null;
  private searchFtsStmt: Database.Statement | null = null;
  private markIndexedStmt: Database.Statement | null = null;
  private unmarkIndexedStmt: Database.Statement | null = null;
  private unmarkIndexedBySessionStmt: Database.Statement | null = null;
  private unmarkIndexedFromTimestampStmt: Database.Statement | null = null;

  constructor(private readonly database: Database.Database) {
    this.ftsAvailable = probeFts5Available(database);
  }

  ensureSchema(): void {
    if (!this.ftsAvailable) {
      logWarn(
        '[MessageSearch] FTS5 unavailable in embedded SQLite — using LIKE fallback (no side index)'
      );
      return;
    }

    this.database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(
        message_id UNINDEXED,
        session_id UNINDEXED,
        role UNINDEXED,
        timestamp UNINDEXED,
        session_title,
        body,
        tokenize = 'unicode61'
      )
    `);

    this.database.exec(`
      CREATE TABLE IF NOT EXISTS ${BACKFILL_META_TABLE} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Tracks messages already considered by backfill/sync, including those skipped
    // because they had no indexable text (avoids infinite backfill loops).
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS ${INDEXED_STATE_TABLE} (
        message_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    this.insertFtsStmt = this.database.prepare(`
      INSERT INTO ${FTS_TABLE}
        (message_id, session_id, role, timestamp, session_title, body)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.deleteFtsByMessageStmt = this.database.prepare(
      `DELETE FROM ${FTS_TABLE} WHERE message_id = ?`
    );
    this.deleteFtsBySessionStmt = this.database.prepare(
      `DELETE FROM ${FTS_TABLE} WHERE session_id = ?`
    );
    this.deleteFtsSessionMessagesStmt = this.database.prepare(
      `DELETE FROM ${FTS_TABLE} WHERE session_id = ? AND message_id NOT LIKE ?`
    );
    this.deleteFtsFromTimestampStmt = this.database.prepare(
      `DELETE FROM ${FTS_TABLE}
       WHERE session_id = ? AND timestamp >= ? AND message_id NOT LIKE ?`
    );
    this.updateFtsTitleStmt = this.database.prepare(
      `UPDATE ${FTS_TABLE} SET session_title = ? WHERE session_id = ?`
    );
    this.searchFtsStmt = this.database.prepare(`
      SELECT message_id, session_id, role, timestamp, session_title, body
      FROM ${FTS_TABLE}
      WHERE ${FTS_TABLE} MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    this.markIndexedStmt = this.database.prepare(`
      INSERT INTO ${INDEXED_STATE_TABLE} (message_id, session_id, timestamp)
      VALUES (?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        session_id = excluded.session_id,
        timestamp = excluded.timestamp
    `);
    this.unmarkIndexedStmt = this.database.prepare(
      `DELETE FROM ${INDEXED_STATE_TABLE} WHERE message_id = ?`
    );
    this.unmarkIndexedBySessionStmt = this.database.prepare(
      `DELETE FROM ${INDEXED_STATE_TABLE} WHERE session_id = ?`
    );
    this.unmarkIndexedFromTimestampStmt = this.database.prepare(
      `DELETE FROM ${INDEXED_STATE_TABLE}
       WHERE session_id = ? AND timestamp >= ?`
    );

    log('[MessageSearch] FTS5 schema ready');
  }

  upsertMessage(message: {
    id: string;
    session_id: string;
    role: string;
    content: string;
    timestamp: number;
  }): void {
    if (
      !this.ftsAvailable ||
      !this.insertFtsStmt ||
      !this.deleteFtsByMessageStmt ||
      !this.markIndexedStmt
    ) {
      return;
    }

    const body = extractIndexableMessageText(message.role, message.content);
    this.deleteFtsByMessageStmt.run(message.id);
    this.markIndexedStmt.run(message.id, message.session_id, message.timestamp);

    if (!body) {
      return;
    }

    const titleRow = this.database
      .prepare('SELECT title FROM sessions WHERE id = ?')
      .get(message.session_id) as { title: string } | undefined;
    const sessionTitle = titleRow?.title ?? '';

    this.insertFtsStmt.run(
      message.id,
      message.session_id,
      message.role,
      message.timestamp,
      sessionTitle,
      body
    );
  }

  removeMessage(messageId: string): void {
    if (!this.ftsAvailable || !this.deleteFtsByMessageStmt || !this.unmarkIndexedStmt) {
      return;
    }
    this.deleteFtsByMessageStmt.run(messageId);
    this.unmarkIndexedStmt.run(messageId);
  }

  removeSession(sessionId: string): void {
    if (
      !this.ftsAvailable ||
      !this.deleteFtsBySessionStmt ||
      !this.unmarkIndexedBySessionStmt
    ) {
      return;
    }
    this.deleteFtsBySessionStmt.run(sessionId);
    this.unmarkIndexedBySessionStmt.run(sessionId);
  }

  /** Remove message docs for a session but keep the title document. */
  removeSessionMessages(sessionId: string): void {
    if (
      !this.ftsAvailable ||
      !this.deleteFtsSessionMessagesStmt ||
      !this.unmarkIndexedBySessionStmt
    ) {
      return;
    }
    this.deleteFtsSessionMessagesStmt.run(
      sessionId,
      `${MESSAGE_SEARCH_TITLE_DOC_PREFIX}%`
    );
    this.unmarkIndexedBySessionStmt.run(sessionId);
  }

  removeFromTimestamp(sessionId: string, fromTimestamp: number): void {
    if (
      !this.ftsAvailable ||
      !this.deleteFtsFromTimestampStmt ||
      !this.unmarkIndexedFromTimestampStmt
    ) {
      return;
    }
    // Keep the title document (timestamp 0, id prefix t:) when rewinding messages.
    this.deleteFtsFromTimestampStmt.run(
      sessionId,
      fromTimestamp,
      `${MESSAGE_SEARCH_TITLE_DOC_PREFIX}%`
    );
    this.unmarkIndexedFromTimestampStmt.run(sessionId, fromTimestamp);
  }

  upsertSessionTitle(sessionId: string, title: string): void {
    if (!this.ftsAvailable || !this.insertFtsStmt || !this.deleteFtsByMessageStmt) {
      return;
    }

    const trimmed = title.trim();
    if (this.updateFtsTitleStmt) {
      this.updateFtsTitleStmt.run(trimmed, sessionId);
    }

    const docId = titleDocId(sessionId);
    this.deleteFtsByMessageStmt.run(docId);
    if (trimmed) {
      this.insertFtsStmt.run(docId, sessionId, '', 0, trimmed, '');
    }
  }

  search(query: string, limit = DEFAULT_SEARCH_LIMIT): SessionMessageSearchHit[] {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

    if (this.ftsAvailable && this.searchFtsStmt) {
      return this.searchFts(trimmed, safeLimit);
    }

    return this.searchLike(trimmed, safeLimit);
  }

  /** Synchronously index up to `chunkSize` missing rows. Returns true if more remain. */
  backfillChunk(chunkSize = DEFAULT_BACKFILL_CHUNK): boolean {
    if (!this.ftsAvailable || !this.insertFtsStmt || !this.deleteFtsByMessageStmt) {
      return false;
    }

    const safeChunk = Math.max(1, Math.min(500, Math.floor(chunkSize)));

    // Titles first (idempotent upsert).
    const sessions = this.database
      .prepare(
        `
        SELECT id, title FROM sessions
        WHERE id NOT IN (
          SELECT session_id FROM ${FTS_TABLE}
          WHERE message_id LIKE ?
        )
        LIMIT ?
      `
      )
      .all(`${MESSAGE_SEARCH_TITLE_DOC_PREFIX}%`, safeChunk) as Array<{
      id: string;
      title: string;
    }>;

    for (const session of sessions) {
      this.upsertSessionTitle(session.id, session.title);
    }

    if (sessions.length >= safeChunk) {
      return true;
    }

    const remaining = safeChunk - sessions.length;
    const messages = this.database
      .prepare(
        `
        SELECT m.id, m.session_id, m.role, m.content, m.timestamp
        FROM messages m
        WHERE m.role IN ('user', 'assistant')
          AND m.id NOT IN (SELECT message_id FROM ${INDEXED_STATE_TABLE})
        ORDER BY m.timestamp ASC
        LIMIT ?
      `
      )
      .all(remaining) as Array<{
      id: string;
      session_id: string;
      role: string;
      content: string;
      timestamp: number;
    }>;

    for (const message of messages) {
      this.upsertMessage(message);
    }

    return messages.length >= remaining;
  }

  scheduleBackfill(chunkSize = DEFAULT_BACKFILL_CHUNK): void {
    if (!this.ftsAvailable || this.backfillRunning) {
      return;
    }

    this.backfillRunning = true;
    const runChunk = (): void => {
      try {
        const more = this.backfillChunk(chunkSize);
        if (more) {
          setTimeout(runChunk, 0);
          return;
        }
        this.setMeta('backfill_complete', '1');
        log('[MessageSearch] Background backfill complete');
        this.backfillRunning = false;
      } catch (error) {
        logError('[MessageSearch] Backfill chunk failed:', error);
        this.backfillRunning = false;
      }
    };

    setTimeout(runChunk, 0);
  }

  /** Test helper — number of FTS rows currently indexed. */
  getIndexedCount(): number {
    if (!this.ftsAvailable) {
      return 0;
    }
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM ${FTS_TABLE}`).get() as {
      count: number;
    };
    return row.count;
  }

  private searchFts(query: string, limit: number): SessionMessageSearchHit[] {
    const matchQuery = escapeFts5Query(query);
    if (!matchQuery || !this.searchFtsStmt) {
      return [];
    }

    try {
      const rows = this.searchFtsStmt.all(matchQuery, limit) as FtsRow[];
      return rows.map((row) => this.toHit(row, query));
    } catch (error) {
      logError('[MessageSearch] FTS query failed, falling back to LIKE:', error);
      return this.searchLike(query, limit);
    }
  }

  private searchLike(query: string, limit: number): SessionMessageSearchHit[] {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) {
      return [];
    }

    const hits: SessionMessageSearchHit[] = [];
    const likePattern = `%${escapeLikePattern(normalizedQuery)}%`;

    const titleRows = this.database
      .prepare(
        `
        SELECT id, title, updated_at
        FROM sessions
        WHERE LOWER(title) LIKE ? ESCAPE '\\'
        ORDER BY updated_at DESC
        LIMIT ?
      `
      )
      .all(likePattern, limit) as Array<{ id: string; title: string; updated_at: number }>;

    for (const row of titleRows) {
      const { excerpt, highlights } = buildHighlightedExcerpt(row.title, query);
      hits.push({
        sessionId: row.id,
        sessionTitle: row.title,
        messageId: null,
        role: null,
        timestamp: row.updated_at,
        excerpt,
        highlights,
      });
      if (hits.length >= limit) {
        return hits;
      }
    }

    const messageRows = this.database
      .prepare(
        `
        SELECT m.id, m.session_id, m.role, m.content, m.timestamp, s.title
        FROM messages m
        JOIN sessions s ON s.id = m.session_id
        WHERE m.role IN ('user', 'assistant')
        ORDER BY m.timestamp DESC
        LIMIT 2000
      `
      )
      .all() as MessageScanRow[];

    for (const row of messageRows) {
      const body = extractIndexableMessageText(row.role, row.content);
      if (!body) continue;
      if (!normalizeSearchText(body).includes(normalizedQuery)) {
        continue;
      }
      const { excerpt, highlights } = buildHighlightedExcerpt(body, query);
      hits.push({
        sessionId: row.session_id,
        sessionTitle: row.title,
        messageId: row.id,
        role: row.role === 'assistant' ? 'assistant' : 'user',
        timestamp: row.timestamp,
        excerpt,
        highlights,
      });
      if (hits.length >= limit) {
        break;
      }
    }

    return hits;
  }

  private toHit(row: FtsRow, query: string): SessionMessageSearchHit {
    const titleOnly = isTitleDocId(row.message_id);
    const source = titleOnly || !row.body.trim() ? row.session_title : row.body;
    const { excerpt, highlights } = buildHighlightedExcerpt(source, query);
    const role =
      row.role === 'user' || row.role === 'assistant'
        ? row.role
        : null;

    return {
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      messageId: titleOnly ? null : row.message_id,
      role,
      timestamp: row.timestamp,
      excerpt,
      highlights,
    };
  }

  private setMeta(key: string, value: string): void {
    this.database
      .prepare(
        `
        INSERT INTO ${BACKFILL_META_TABLE} (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `
      )
      .run(key, value);
  }
}
