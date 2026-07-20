/**
 * Run-scoped "approve all write/edit for this run" memory for careful mode.
 * Cleared when a run starts or ends.
 */

const allowRunBySession = new Set<string>();

export function rememberCarefulAllowRun(sessionId: string): void {
  allowRunBySession.add(sessionId);
}

export function hasCarefulAllowRun(sessionId: string): boolean {
  return allowRunBySession.has(sessionId);
}

export function clearCarefulAllowRun(sessionId: string): void {
  allowRunBySession.delete(sessionId);
}
