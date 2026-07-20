/**
 * Client-side generation stats (tok/s) derived from stream deltas already received.
 * Token estimate matches main/agent/context-budget.estimateTokensFromText (chars/4).
 */

export interface StreamTokenSample {
  /** Wall-clock arrival time (ms). */
  at: number;
  /** Cumulative generated text length after this sample (chars). */
  cumulativeChars: number;
}

/** Same heuristic as `estimateTokensFromText` in context-budget.ts. */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Compute tokens/second from ordered stream samples.
 * - 0 tokens → 0
 * - single burst / zero elapsed → null (rate undefined)
 */
export function computeTokensPerSecond(samples: readonly StreamTokenSample[]): number | null {
  if (samples.length === 0) {
    return null;
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  // Equivalent to estimateTokensFromText on a string of that length (chars/4).
  const tokens = last.cumulativeChars <= 0 ? 0 : Math.ceil(last.cumulativeChars / 4);

  if (tokens === 0) {
    return 0;
  }

  const elapsedMs = last.at - first.at;
  if (elapsedMs <= 0) {
    // Unique burst: all text arrived in one frame — rate is undefined.
    return null;
  }

  return tokens / (elapsedMs / 1000);
}

/**
 * Convenience when only cumulative text + first/last timestamps are known.
 */
export function computeTokensPerSecondFromText(
  text: string,
  startedAt: number,
  endedAt: number
): number | null {
  return computeTokensPerSecond([
    { at: startedAt, cumulativeChars: 0 },
    { at: endedAt, cumulativeChars: text.length },
  ]);
}

/** Format a tok/s value for discreet UI display (e.g. "12.4"). */
export function formatTokensPerSecond(rate: number): string {
  if (!Number.isFinite(rate) || rate < 0) {
    return '0';
  }
  if (rate >= 100) {
    return String(Math.round(rate));
  }
  if (rate >= 10) {
    return rate.toFixed(1);
  }
  return rate.toFixed(2);
}
