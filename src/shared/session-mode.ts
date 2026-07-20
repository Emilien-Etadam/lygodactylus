/**
 * Per-session Plan / Act mode.
 *
 * - `act` (default): full toolset, current behavior unchanged.
 * - `plan`: read-only exploration + planning; writes, shell, and outbound
 *   action tools are filtered out before the pi session is created.
 *
 * MCP tools have no reliable read-only metadata in this app, so they are
 * blocked entirely in plan mode (conservative choice).
 */

export type SessionMode = 'plan' | 'act';

export const DEFAULT_SESSION_MODE: SessionMode = 'act';

/** Constant system-prompt section for plan mode (stable prefix within a mode). */
export const PLAN_MODE_SYSTEM_PROMPT =
  '<plan_mode>\nPlanning mode: explore with read-only tools, ask clarifying questions if needed, and produce a numbered action plan. Do not execute anything — no file writes, no commands, no mutating actions.\n</plan_mode>';

/**
 * Built-in pi tools excluded in plan mode (write / shell).
 * `read` remains available via the SDK default toolset.
 */
export const PLAN_MODE_EXCLUDED_BUILTIN_TOOLS = ['bash', 'edit', 'write'] as const;

/** Exact tool names allowed as custom tools in plan mode (allowlist). */
export const PLAN_MODE_ALLOWED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read',
  'glob',
  'find',
  'grep',
  'semantic_search',
  'ls',
  'list_directory',
  'web_search',
  'websearch',
  'WebSearch',
  'web_fetch',
  'WebFetch',
  'ask_user_question',
  'AskUserQuestion',
  'todo_write',
  'TodoWrite',
  'todoread',
  'TodoRead',
]);

export function isSessionMode(value: unknown): value is SessionMode {
  return value === 'plan' || value === 'act';
}

export function normalizeSessionMode(value: unknown): SessionMode {
  return isSessionMode(value) ? value : DEFAULT_SESSION_MODE;
}

export function isMcpToolName(toolName: string): boolean {
  return toolName.startsWith('mcp__') || toolName.startsWith('mcp_');
}

export function isToolAllowedInSessionMode(toolName: string, mode: SessionMode): boolean {
  if (mode === 'act') {
    return true;
  }
  // Conservative: block all MCP tools in plan mode (no read-only metadata).
  if (isMcpToolName(toolName)) {
    return false;
  }
  return PLAN_MODE_ALLOWED_TOOL_NAMES.has(toolName);
}

/**
 * Single filtering point for the assembled custom toolset.
 * In `act` mode the array is returned unchanged (same reference).
 */
export function filterToolsForSessionMode<T extends { name: string }>(
  tools: T[],
  mode: SessionMode
): T[] {
  if (mode === 'act') {
    return tools;
  }
  return tools.filter((tool) => isToolAllowedInSessionMode(tool.name, mode));
}

export function getPlanModeExcludedBuiltinTools(mode: SessionMode): string[] | undefined {
  if (mode === 'act') {
    return undefined;
  }
  return [...PLAN_MODE_EXCLUDED_BUILTIN_TOOLS];
}
