/**
 * Thinking↔tool guard for Qwen3.x served through vLLM / SGLang.
 *
 * Qwen3.5/3.6 in thinking mode intermittently ends a turn still inside an
 * unclosed <think> block exactly where it meant to emit a tool call: the
 * reasoning parser then swallows the call, `tool_calls` comes back empty, no
 * tool runs and the agent stalls (the model just "announces" the call in its
 * reasoning and stops). It worsens with many tools and deep context — the very
 * conditions of an agentic session. See docs/qwen-local-reliability.md.
 *
 * Reasoning buys little for tool *selection*, and the failure only exists when
 * there is a <think> block to get stuck in. So whenever an outbound request
 * carries tools we force `chat_template_kwargs.enable_thinking = false` (which
 * also overrides a server-side `--default-chat-template-kwargs enable_thinking`).
 * Scoped to the qwen-chat-template thinking rail (see
 * modelUsesQwenChatTemplateThinking): other rails — Anthropic, Ollama
 * (reasoning_effort), DeepSeek (thinking-in-content) — never carry this key.
 *
 * Pure helpers + a thin host extension using the official
 * before_provider_request hook, mirroring ollama-payload-extension.ts and the
 * pure/unit-testable shape of hallucinated-toolcall-guard.ts.
 */
import type { InlineExtension } from '@earendil-works/pi-coding-agent';

export const THINKING_TOOL_GUARD_EXTENSION_NAME = 'thinking-tool-guard';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** True when the outbound provider payload carries at least one tool. */
export function payloadHasTools(payload: unknown): boolean {
  return (
    isPlainObject(payload) &&
    Array.isArray((payload as { tools?: unknown }).tools) &&
    (payload as { tools: unknown[] }).tools.length > 0
  );
}

/**
 * When the payload carries tools, force `chat_template_kwargs.enable_thinking`
 * to false — merging into any existing chat_template_kwargs, never clobbering
 * sibling keys (e.g. preserve_thinking). Returns the same reference untouched
 * when there are no tools or thinking is already disabled, so it is safe to run
 * on every request.
 */
export function disableThinkingWhenToolsPresent(
  payload: Record<string, unknown>
): Record<string, unknown> {
  if (!payloadHasTools(payload)) {
    return payload;
  }
  const existing = isPlainObject(payload.chat_template_kwargs) ? payload.chat_template_kwargs : {};
  if (existing.enable_thinking === false) {
    return payload;
  }
  return {
    ...payload,
    chat_template_kwargs: { ...existing, enable_thinking: false },
  };
}

/**
 * Hidden InlineExtension that disables reasoning on any tool-bearing request via
 * the official before_provider_request hook. Register only for the
 * qwen-chat-template thinking rail (see modelUsesQwenChatTemplateThinking).
 */
export function createThinkingToolGuardExtension(): InlineExtension {
  return {
    name: THINKING_TOOL_GUARD_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.on('before_provider_request', (event) => {
        const payload = event.payload;
        if (!isPlainObject(payload)) {
          return payload;
        }
        return disableThinkingWhenToolsPresent(payload);
      });
    },
  };
}
