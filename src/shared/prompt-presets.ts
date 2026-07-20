/**
 * Prompt presets — reusable local templates with {{variables}} and {date}/{os} tokens.
 */

export interface PromptPreset {
  id: string;
  name: string;
  description: string;
  text: string;
  /** Optional instructions prepended to the USER prompt (not the stable system prefix). */
  systemPrompt: string;
  /** Auto-detected {{variable}} names (unique, first-seen order). */
  variables: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PromptPresetCreateInput {
  name: string;
  description?: string;
  text: string;
  systemPrompt?: string;
}

export interface PromptPresetUpdateInput {
  name?: string;
  description?: string;
  text?: string;
  /** Pass null or empty string to clear. */
  systemPrompt?: string | null;
}

/** Matches `{{name}}` but not nested braces inside the name. */
const TEMPLATE_VARIABLE_RE = /\{\{([^{}]+)\}\}/g;

/** Dynamic tokens resolved at insertion time (not user-filled). */
const DYNAMIC_TOKEN_RE = /\{(date|os)\}/g;

/**
 * Detect `{{variable}}` placeholders. Duplicates are collapsed (first wins).
 * Nested braces like `{{a{{b}}}}` only yield the innermost well-formed match (`b`).
 */
export function detectTemplateVariables(...texts: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const text of texts) {
    if (!text) continue;
    TEMPLATE_VARIABLE_RE.lastIndex = 0;
    for (const match of text.matchAll(TEMPLATE_VARIABLE_RE)) {
      const name = match[1]?.trim() ?? '';
      if (!name || seen.has(name)) continue;
      seen.add(name);
      result.push(name);
    }
  }

  return result;
}

export interface DynamicTokenContext {
  date?: string;
  os?: string;
}

export function defaultDynamicTokenContext(): Required<DynamicTokenContext> {
  return {
    date: new Date().toISOString().slice(0, 10),
    os: typeof process !== 'undefined' && process.platform ? process.platform : 'unknown',
  };
}

/**
 * Replace `{date}` and `{os}` tokens. Unknown `{…}` forms are left untouched.
 */
export function resolveDynamicTokens(
  text: string,
  context: DynamicTokenContext = {}
): string {
  const defaults = defaultDynamicTokenContext();
  const date = context.date ?? defaults.date;
  const os = context.os ?? defaults.os;

  return text.replace(DYNAMIC_TOKEN_RE, (_full, token: string) => {
    if (token === 'date') return date;
    if (token === 'os') return os;
    return `{${token}}`;
  });
}

/**
 * Substitute `{{variable}}` placeholders. Missing keys leave the placeholder intact.
 */
export function applyVariableValues(text: string, values: Record<string, string>): string {
  TEMPLATE_VARIABLE_RE.lastIndex = 0;
  return text.replace(TEMPLATE_VARIABLE_RE, (full, rawName: string) => {
    const name = rawName.trim();
    if (!name) return full;
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      return values[name] ?? '';
    }
    return full;
  });
}

/**
 * Build the final draft inserted into the chat input:
 * optional systemPrompt (user-prompt prefix) + expanded body.
 * Does not send the message.
 */
export function buildPresetInsertionText(
  preset: Pick<PromptPreset, 'text' | 'systemPrompt'>,
  values: Record<string, string>,
  context?: DynamicTokenContext
): string {
  const expand = (source: string): string =>
    resolveDynamicTokens(applyVariableValues(source, values), context);

  const body = expand(preset.text);
  const system = preset.systemPrompt.trim();
  if (!system) {
    return body;
  }
  return `${expand(system)}\n\n${body}`;
}
