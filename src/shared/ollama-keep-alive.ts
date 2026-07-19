/**
 * Ollama keep_alive duration helpers (shared main/renderer).
 *
 * Ollama accepts either a duration string ("30m", "1h") or a number of seconds.
 * @see https://github.com/ollama/ollama/blob/main/docs/api.md
 */

export const DEFAULT_OLLAMA_KEEP_ALIVE = '30m';

/** Duration string (`30m`, `1h`, `-1`) or bare seconds (`1800`). */
const KEEP_ALIVE_PATTERN = /^-?\d+(\.\d+)?([smhd])?$/i;

/**
 * Soft-normalize a config value to a valid Ollama keep_alive duration.
 * Invalid / empty values fall back to the default (soft migration).
 */
export function normalizeOllamaKeepAlive(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return DEFAULT_OLLAMA_KEEP_ALIVE;
  }
  const trimmed = String(value).trim();
  if (!trimmed || !KEEP_ALIVE_PATTERN.test(trimmed)) {
    return DEFAULT_OLLAMA_KEEP_ALIVE;
  }
  return trimmed;
}

/**
 * Map a normalized keep_alive unit string to the JSON payload value.
 * Bare integers are sent as numbers (seconds); durations with a unit stay strings.
 */
export function toOllamaKeepAlivePayload(keepAlive: string): string | number {
  const normalized = normalizeOllamaKeepAlive(keepAlive);
  if (/^-?\d+$/.test(normalized)) {
    return Number(normalized);
  }
  return normalized;
}
