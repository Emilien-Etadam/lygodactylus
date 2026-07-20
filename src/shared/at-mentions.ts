/**
 * @-mention parsing and autocomplete query helpers (renderer + main safe).
 *
 * Mentions are triggered by `@` at a word boundary. Paths stop at whitespace or
 * another `@`. URLs are detected when the token starts with http:// or https://.
 * Escaped `\@` is ignored.
 */

export type AtMentionTokenKind = 'path' | 'url';

export interface ParsedAtMention {
  /** Mention body without the leading `@`. */
  value: string;
  kind: AtMentionTokenKind;
  /** Index of `@` in the source string. */
  start: number;
  /** Exclusive end index of the mention token. */
  end: number;
}

const URL_PREFIX_RE = /^https?:\/\//i;
const TRAILING_PATH_PUNCT_RE = /[.,;:!?)\]}'"]+$/;

/** Characters that may precede `@` for it to count as a word-start mention. */
function isMentionBoundary(char: string | undefined): boolean {
  if (char === undefined) {
    return true;
  }
  return /[\s([{<"']/.test(char);
}

function stripTrailingPunctuation(token: string, kind: AtMentionTokenKind): string {
  if (kind === 'url') {
    // Keep URL path punctuation; only strip common sentence closers.
    return token.replace(/[.,;!?)]+$/, '');
  }
  return token.replace(TRAILING_PATH_PUNCT_RE, '');
}

/**
 * Parse all @-mentions in `text`. Escaped `\@` sequences are skipped.
 */
export function parseAtMentions(text: string): ParsedAtMention[] {
  if (!text) {
    return [];
  }

  const mentions: ParsedAtMention[] = [];
  let index = 0;

  while (index < text.length) {
    const atIndex = text.indexOf('@', index);
    if (atIndex === -1) {
      break;
    }

    // Escaped \@ — treat as literal and continue after the @.
    if (atIndex > 0 && text[atIndex - 1] === '\\') {
      index = atIndex + 1;
      continue;
    }

    const continuesFromPrevious =
      mentions.length > 0 && mentions[mentions.length - 1]?.end === atIndex;
    if (!isMentionBoundary(text[atIndex - 1]) && !continuesFromPrevious) {
      index = atIndex + 1;
      continue;
    }

    const bodyStart = atIndex + 1;
    if (bodyStart >= text.length) {
      // Lone `@` at end — incomplete, not a resolved mention.
      break;
    }

    let bodyEnd = bodyStart;
    while (bodyEnd < text.length) {
      const ch = text[bodyEnd];
      if (ch === '@' || /\s/.test(ch)) {
        break;
      }
      bodyEnd += 1;
    }

    if (bodyEnd === bodyStart) {
      index = atIndex + 1;
      continue;
    }

    const rawBody = text.slice(bodyStart, bodyEnd);
    const kind: AtMentionTokenKind = URL_PREFIX_RE.test(rawBody) ? 'url' : 'path';
    const value = stripTrailingPunctuation(rawBody, kind);
    if (!value) {
      index = bodyEnd;
      continue;
    }

    const consumed = value.length;
    mentions.push({
      value,
      kind,
      start: atIndex,
      end: bodyStart + consumed,
    });
    index = bodyStart + consumed;
  }

  return mentions;
}

/**
 * Active autocomplete query: `@…` being typed at the end of the input.
 * Returns the query string (may be empty right after `@`), or null when inactive.
 */
export function getAtMentionQuery(input: string): string | null {
  if (!input) {
    return null;
  }

  const match = input.match(/(?:^|[\s([{<"'])@([^\s@]*)$/);
  if (!match) {
    return null;
  }
  return match[1] ?? '';
}

/**
 * Whether `query` looks like an in-progress or complete URL mention.
 */
export function isAtMentionUrlQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return false;
  }
  if (URL_PREFIX_RE.test(trimmed)) {
    return true;
  }
  // Partial typing of a URL scheme after @
  return /^(https?:\/\/?|https?|https?:)$/i.test(trimmed);
}

export interface WorkspacePathSuggestion {
  relativePath: string;
  kind: 'file' | 'directory';
}

/**
 * Simple fuzzy score for relative paths. Higher is better; 0 means no match.
 * Prefer basename hits, contiguous substring matches, then subsequence matches.
 */
export function scoreWorkspacePathQuery(relativePath: string, query: string): number {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const normalizedQuery = query.trim().replace(/\\/g, '/').toLowerCase();
  if (!normalizedQuery) {
    // Empty query: mild preference for shallow paths.
    const depth = normalizedPath.split('/').filter(Boolean).length;
    return Math.max(1, 40 - depth);
  }

  const pathLower = normalizedPath.toLowerCase();
  const baseName = pathLower.split('/').pop() || pathLower;

  if (pathLower === normalizedQuery) {
    return 1000;
  }
  if (baseName === normalizedQuery) {
    return 900;
  }
  if (baseName.startsWith(normalizedQuery)) {
    return 800 - Math.min(baseName.length, 100);
  }
  if (pathLower.startsWith(normalizedQuery)) {
    return 700 - Math.min(pathLower.length, 100);
  }
  if (baseName.includes(normalizedQuery)) {
    return 600 - baseName.indexOf(normalizedQuery);
  }
  if (pathLower.includes(normalizedQuery)) {
    return 500 - pathLower.indexOf(normalizedQuery);
  }

  // Subsequence match (fzy-style light).
  let qi = 0;
  let score = 200;
  let lastMatch = -1;
  for (let pi = 0; pi < pathLower.length && qi < normalizedQuery.length; pi += 1) {
    if (pathLower[pi] === normalizedQuery[qi]) {
      if (lastMatch === pi - 1) {
        score += 3;
      }
      if (pi === 0 || pathLower[pi - 1] === '/') {
        score += 8;
      }
      lastMatch = pi;
      qi += 1;
    }
  }
  if (qi === normalizedQuery.length) {
    return score - Math.min(pathLower.length, 80);
  }

  return 0;
}

export function filterWorkspacePathSuggestions(
  entries: readonly WorkspacePathSuggestion[],
  query: string,
  limit = 20
): WorkspacePathSuggestion[] {
  const scored = entries
    .map((entry) => ({ entry, score: scoreWorkspacePathQuery(entry.relativePath, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.entry.kind !== b.entry.kind) {
        // Directories first on ties — useful for navigating into folders.
        return a.entry.kind === 'directory' ? -1 : 1;
      }
      return a.entry.relativePath.localeCompare(b.entry.relativePath);
    });

  return scored.slice(0, Math.max(0, limit)).map((item) => item.entry);
}

export const AT_MENTION_FILE_BYTE_LIMIT = 64 * 1024;

export function formatAttachedContextBlock(source: string, body: string): string {
  return `<attached_context source="${escapeXmlAttr(source)}">\n${body}\n</attached_context>`;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
