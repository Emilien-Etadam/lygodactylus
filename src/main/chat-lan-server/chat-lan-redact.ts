/**
 * @module main/chat-lan-server/chat-lan-redact
 *
 * The desktop renderer receives the full AppConfig (including cleartext API
 * keys) over Electron IPC. Anything mirrored to the LAN bridge must be
 * scrubbed first: a LAN client only needs non-secret UI state (theme,
 * memoryEnabled, language...), never credentials.
 */

const SECRET_KEYS = new Set(['apiKey', 'authToken', 'token', 'extensionToken', 'password']);

/** Deep-copy `value` with every known secret field blanked. */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(key) && typeof entry === 'string') {
        out[key] = entry ? '__redacted__' : '';
      } else {
        out[key] = redactSecrets(entry);
      }
    }
    return out as T;
  }
  return value;
}
