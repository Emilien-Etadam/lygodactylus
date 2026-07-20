/**
 * Shared types for local conversation full-text search (desktop IPC).
 */

export interface SessionMessageSearchHit {
  sessionId: string;
  sessionTitle: string;
  /** Null when the hit is a session-title document (no message to open). */
  messageId: string | null;
  role: 'user' | 'assistant' | null;
  timestamp: number;
  excerpt: string;
  /** Character ranges in `excerpt` to highlight, as [start, end) pairs. */
  highlights: Array<[number, number]>;
}

export interface SessionMessageSearchGroup {
  sessionId: string;
  sessionTitle: string;
  hits: SessionMessageSearchHit[];
}
