/**
 * Hallucinated tool-call guard — detects tool calls that the model emitted as
 * plain text instead of a structured tool call.
 *
 * Some local models (notably Qwen3 served through llama.cpp/vLLM with a buggy
 * chat template, and more often past ~32K context) occasionally "hallucinate"
 * a tool call: instead of producing a structured toolCall content block, they
 * write the call out as XML/HTML-like text, e.g.
 *
 *   <tool_call>{"name": "read_file", "arguments": {...}}</tool_call>
 *   <tool_call><function=read_file><parameter=path>...</parameter></function></tool_call>
 *
 * or leave it inside the reasoning stream where it is never executed. The turn
 * then ends without any tool being run and the agent silently stalls.
 *
 * Empirically, simply asking the model to retry fixes it. This guard inspects
 * each assistant turn that ends WITHOUT any structured tool call, and if the
 * emitted text (or, for reasoning-only turns, the reasoning) contains a
 * tool-call-shaped fragment, it asks the host to inject a steering message
 * nudging the model to re-issue the call through the real tool-call mechanism.
 *
 * Guardrails against misfiring:
 *   - Only turns with zero structured tool calls are inspected — if the model
 *     made real calls, the agent loop continues regardless.
 *   - Reasoning is only inspected when the turn produced no visible text at
 *     all (reasoning-only turns): models legitimately *discuss* tool calls in
 *     their reasoning before making them.
 *   - Fenced code blocks and inline code spans are stripped before matching,
 *     so answers that merely quote or document these tags do not trigger.
 *   - At most `maxSteersPerRun` steers are issued per run, after which the
 *     guard goes silent (the loop guard handles genuine runaway behaviour).
 *
 * This module is **pure** — no electron, no logger, no network — so it is
 * trivially unit-testable, mirroring agent-runner-loop-guard.ts. The host
 * (agent-runner-stream-message-events.ts) translates decisions into side
 * effects (sendUserMessage steer).
 */

export interface HallucinatedToolCallConfig {
  /** Maximum number of steering messages injected per run. */
  maxSteersPerRun: number;
}

export const DEFAULT_HALLUCINATED_TOOLCALL_CONFIG: HallucinatedToolCallConfig = {
  maxSteersPerRun: 2,
};

export interface HallucinatedToolCallMatch {
  /** Which syntax family matched (for logs/diagnostics). */
  pattern: 'tool_call_tag' | 'function_tag' | 'function_call_tag' | 'tool_use_tag';
  /** Best-effort extraction of the tool the model was trying to call. */
  toolName?: string;
}

export type HallucinatedToolCallAction = 'none' | 'steer' | 'exhausted';

export interface HallucinatedToolCallDecision {
  action: HallucinatedToolCallAction;
  reason: string;
  match?: HallucinatedToolCallMatch;
  /** How many steers have been issued so far in this run (after this decision). */
  steerCount?: number;
}

const NOOP_DECISION: HallucinatedToolCallDecision = { action: 'none', reason: 'ok' };

// ─── Pure helpers ───────────────────────────────────────────────────────────

/** Remove fenced code blocks and inline code spans so quoted/documented tags don't match. */
export function stripCodeSpans(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/~~~[\s\S]*?(~~~|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

const TOOL_CALL_TAG = /<\/?tool_call>/i;
// XML-style function call used by Qwen-native tool templates: <function=name>
const FUNCTION_TAG = /<function\s*=\s*([\w.-]+)\s*>/i;
const FUNCTION_CALL_TAG = /<\/?function_call>/i;
const TOOL_USE_TAG = /<\/?tool_use>/i;
// JSON payload commonly wrapped in <tool_call> tags: {"name": "x", "arguments": ...}
const JSON_NAME_FIELD = /"name"\s*:\s*"([\w.-]+)"/;

/**
 * Look for a tool-call-shaped fragment in free text. Returns null when the
 * text looks like a normal answer.
 */
export function findHallucinatedToolCall(text: string): HallucinatedToolCallMatch | null {
  if (!text) {
    return null;
  }
  const cleaned = stripCodeSpans(text);

  const functionTag = cleaned.match(FUNCTION_TAG);
  if (functionTag) {
    return { pattern: 'function_tag', toolName: functionTag[1] };
  }
  if (TOOL_CALL_TAG.test(cleaned)) {
    const jsonName = cleaned.match(JSON_NAME_FIELD);
    return { pattern: 'tool_call_tag', toolName: jsonName?.[1] };
  }
  if (FUNCTION_CALL_TAG.test(cleaned)) {
    const jsonName = cleaned.match(JSON_NAME_FIELD);
    return { pattern: 'function_call_tag', toolName: jsonName?.[1] };
  }
  if (TOOL_USE_TAG.test(cleaned)) {
    const jsonName = cleaned.match(JSON_NAME_FIELD);
    return { pattern: 'tool_use_tag', toolName: jsonName?.[1] };
  }
  return null;
}

// ─── Guard class ────────────────────────────────────────────────────────────

export interface TurnContentSnapshot {
  /** Concatenated visible text blocks of the assistant turn. */
  text: string;
  /** Concatenated thinking/reasoning blocks of the assistant turn. */
  thinking: string;
  /** Number of structured toolCall blocks in the turn. */
  structuredToolCallCount: number;
}

export class HallucinatedToolCallGuard {
  private readonly config: HallucinatedToolCallConfig;
  private steersIssued = 0;

  constructor(config: Partial<HallucinatedToolCallConfig> = {}) {
    this.config = { ...DEFAULT_HALLUCINATED_TOOLCALL_CONFIG, ...config };
  }

  /**
   * Inspect a completed assistant turn. Call once per message_end.
   * Returns 'steer' when the host should inject a retry nudge.
   */
  inspectTurn(snapshot: TurnContentSnapshot): HallucinatedToolCallDecision {
    if (snapshot.structuredToolCallCount > 0) {
      return NOOP_DECISION;
    }

    const text = snapshot.text?.trim() ?? '';
    const thinking = snapshot.thinking?.trim() ?? '';
    // Reasoning is only inspected on reasoning-only turns; see module docs.
    const match = text ? findHallucinatedToolCall(text) : findHallucinatedToolCall(thinking);
    if (!match) {
      return NOOP_DECISION;
    }

    if (this.steersIssued >= this.config.maxSteersPerRun) {
      return {
        action: 'exhausted',
        reason: `tool-call-shaped text detected but steer budget (${this.config.maxSteersPerRun}) is exhausted`,
        match,
        steerCount: this.steersIssued,
      };
    }

    this.steersIssued += 1;
    return {
      action: 'steer',
      reason: `turn ended with tool-call-shaped text (${match.pattern}) and no structured tool call`,
      match,
      steerCount: this.steersIssued,
    };
  }

  /** Expose raw counters for diagnostics / testing. */
  snapshot(): { steersIssued: number } {
    return { steersIssued: this.steersIssued };
  }
}

// ─── Model-facing message builder ───────────────────────────────────────────

export function buildHallucinatedToolCallSteerMessage(
  decision: HallucinatedToolCallDecision
): string {
  const toolHint = decision.match?.toolName
    ? ` It looks like you were trying to call the "${decision.match.toolName}" tool.`
    : '';
  return (
    `[Tool-Call Guard] Your last message ended with what looks like a tool call written as plain text (e.g. inside <tool_call> or <function=...> tags) instead of an actual tool invocation, so no tool was executed.${toolHint}\n` +
    'If you intended to call a tool, re-issue that call now using the normal tool-calling mechanism — do not write the call as text or XML. If you did not intend to call a tool, continue with your answer in plain text.'
  );
}
