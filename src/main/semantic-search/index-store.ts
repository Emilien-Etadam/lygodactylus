import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureParentDir } from '../memory/memory-utils';

export interface StoredChunkRow {
  relPath: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  embedding: number[];
}

export interface StoredFileMeta {
  relPath: string;
  mtimeMs: number;
  sizeBytes: number;
  contentHash: string;
}

/**
 * Per-workspace SQLite index for semantic file search.
 * Dedicated file under userData/semantic-index/ — not the memory JSON store.
 */
export class SemanticIndexStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    ensureParentDir(dbPath);
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        rel_path TEXT PRIMARY KEY NOT NULL,
        mtime_ms REAL NOT NULL,
        size_bytes INTEGER NOT NULL,
        content_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rel_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        excerpt TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        FOREIGN KEY (rel_path) REFERENCES files(rel_path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_rel_path ON chunks(rel_path);
    `);
  }

  getFileMeta(relPath: string): StoredFileMeta | null {
    const row = this.db
      .prepare(
        `SELECT rel_path as relPath, mtime_ms as mtimeMs, size_bytes as sizeBytes, content_hash as contentHash
         FROM files WHERE rel_path = ?`
      )
      .get(relPath) as StoredFileMeta | undefined;
    return row ?? null;
  }

  listFilePaths(): string[] {
    const rows = this.db.prepare(`SELECT rel_path as relPath FROM files`).all() as Array<{
      relPath: string;
    }>;
    return rows.map((row) => row.relPath);
  }

  replaceFileChunks(
    meta: StoredFileMeta,
    chunks: Array<{ startLine: number; endLine: number; excerpt: string; embedding: number[] }>
  ): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM chunks WHERE rel_path = ?`).run(meta.relPath);
      this.db
        .prepare(
          `INSERT INTO files (rel_path, mtime_ms, size_bytes, content_hash)
           VALUES (@relPath, @mtimeMs, @sizeBytes, @contentHash)
           ON CONFLICT(rel_path) DO UPDATE SET
             mtime_ms = excluded.mtime_ms,
             size_bytes = excluded.size_bytes,
             content_hash = excluded.content_hash`
        )
        .run(meta);

      const insertChunk = this.db.prepare(
        `INSERT INTO chunks (rel_path, start_line, end_line, excerpt, embedding_json)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const chunk of chunks) {
        insertChunk.run(
          meta.relPath,
          chunk.startLine,
          chunk.endLine,
          chunk.excerpt,
          JSON.stringify(chunk.embedding)
        );
      }
    });
    tx();
  }

  removeFile(relPath: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM chunks WHERE rel_path = ?`).run(relPath);
      this.db.prepare(`DELETE FROM files WHERE rel_path = ?`).run(relPath);
    });
    tx();
  }

  getAllChunks(): StoredChunkRow[] {
    const rows = this.db
      .prepare(
        `SELECT rel_path as relPath, start_line as startLine, end_line as endLine,
                excerpt, embedding_json as embeddingJson
         FROM chunks`
      )
      .all() as Array<{
      relPath: string;
      startLine: number;
      endLine: number;
      excerpt: string;
      embeddingJson: string;
    }>;

    const result: StoredChunkRow[] = [];
    for (const row of rows) {
      const embedding = parseEmbeddingJson(row.embeddingJson);
      if (!embedding) {
        continue;
      }
      result.push({
        relPath: row.relPath,
        startLine: row.startLine,
        endLine: row.endLine,
        excerpt: row.excerpt,
        embedding,
      });
    }
    return result;
  }

  close(): void {
    this.db.close();
  }
}

function parseEmbeddingJson(raw: string): number[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    if (!parsed.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      return null;
    }
    return parsed as number[];
  } catch {
    return null;
  }
}

export function semanticIndexDbPath(storageRoot: string, workspaceHash: string): string {
  return path.join(storageRoot, `${workspaceHash}.sqlite`);
}

export function ensureSemanticIndexDir(storageRoot: string): void {
  fs.mkdirSync(storageRoot, { recursive: true });
}
