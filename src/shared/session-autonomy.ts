/**
 * Per-session autonomy level (orthogonal to Plan / Act mode).
 *
 * - `normal` (default): current permission / tool behavior unchanged.
 * - `careful`: every write/edit must be approved (with unified diff) before FS mutation.
 * - `autonomous`: after a run that modified files, run configured lint/test and
 *   auto-retry fixes up to a fixed iteration ceiling.
 */

export type SessionAutonomy = 'careful' | 'normal' | 'autonomous';

export const DEFAULT_SESSION_AUTONOMY: SessionAutonomy = 'normal';

/** Max autonomous lint/test fix iterations after a mutating run. */
export const AUTONOMOUS_MAX_ITERATIONS = 3;

/** Truncate lint/test stdout+stderr fed back to the model (bytes). */
export const AUTONOMOUS_OUTPUT_TRUNCATE_BYTES = 8 * 1024;

export function isSessionAutonomy(value: unknown): value is SessionAutonomy {
  return value === 'careful' || value === 'normal' || value === 'autonomous';
}

export function normalizeSessionAutonomy(value: unknown): SessionAutonomy {
  return isSessionAutonomy(value) ? value : DEFAULT_SESSION_AUTONOMY;
}
