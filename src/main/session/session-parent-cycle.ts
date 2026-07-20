/**
 * Prevent cycles in the session parent_session_id hierarchy
 * (a parent must not become a child of its descendant).
 */
import type { DatabaseInstance } from '../db/database';

/**
 * Returns true if setting `sessionId`'s parent to `parentSessionId` would
 * create a cycle (including self-parent).
 */
export function wouldCreateSessionParentCycle(
  db: DatabaseInstance,
  sessionId: string,
  parentSessionId: string | null | undefined
): boolean {
  if (!parentSessionId) {
    return false;
  }
  if (parentSessionId === sessionId) {
    return true;
  }

  const seen = new Set<string>([sessionId]);
  let current: string | null = parentSessionId;

  while (current) {
    if (seen.has(current)) {
      return true;
    }
    seen.add(current);
    const row = db.sessions.get(current);
    current = row?.parent_session_id ?? null;
  }

  return false;
}

/**
 * Assign parent_session_id with cycle validation.
 * Returns false when the assignment would create a cycle.
 */
export function setSessionParentId(
  db: DatabaseInstance,
  sessionId: string,
  parentSessionId: string | null
): { success: boolean; errorKey?: 'errSessionParentCycle' } {
  if (wouldCreateSessionParentCycle(db, sessionId, parentSessionId)) {
    return { success: false, errorKey: 'errSessionParentCycle' };
  }
  db.sessions.update(sessionId, { parent_session_id: parentSessionId });
  return { success: true };
}
