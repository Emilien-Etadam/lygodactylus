/**
 * Inline SDK extension that injects Ollama keep_alive / num_ctx into each
 * provider request via the official before_provider_request hook (pi ≥ 0.81).
 *
 * keep_alive is read live from configStore on every request (never frozen at
 * session prep). num_ctx is a mutable ref updated on model hot-swap / compaction.
 */
import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { configStore } from '../config/config-store';
import {
  normalizeOllamaKeepAlive,
  toOllamaKeepAlivePayload,
} from '../config/ollama-api';

export const OLLAMA_PAYLOAD_EXTENSION_NAME = 'ollama-payload';

export type OllamaNumCtxRef = { value: number };

/**
 * Build a hidden InlineExtension that extends the outbound provider payload
 * with Ollama-specific fields without clobbering other keys.
 */
export function createOllamaPayloadExtension(ollamaNumCtx: OllamaNumCtxRef): InlineExtension {
  return {
    name: OLLAMA_PAYLOAD_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.on('before_provider_request', (event) => {
        const base =
          event.payload !== null &&
          typeof event.payload === 'object' &&
          !Array.isArray(event.payload)
            ? (event.payload as Record<string, unknown>)
            : {};
        const keepAlive = normalizeOllamaKeepAlive(configStore.get('ollamaKeepAlive'));
        return {
          ...base,
          num_ctx: ollamaNumCtx.value,
          keep_alive: toOllamaKeepAlivePayload(keepAlive),
        };
      });
    },
  };
}
