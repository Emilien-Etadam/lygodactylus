/**
 * Web citation index for web_search / web_fetch tool results.
 *
 * Stable prefix so the model (and the UI) can locate numbered sources without
 * extra network calls. Numbers are allocated per agent turn via a counter.
 */

export const WEB_CITATION_INDEX_PREFIX = 'Source index:';

/** Line shape: `[n] title — url` (em dash). */
const CITATION_LINE_RE = /^\[(\d+)\]\s+(.+?)\s+—\s+(\S+)\s*$/;

/** Inline markers in assistant text: `[1]`, `[12]`. */
const INLINE_CITATION_RE = /\[(\d+)\]/g;

export interface WebCitationSource {
  index: number;
  title: string;
  url: string;
}

export interface WebCitationCounter {
  nextIndex: number;
}

export function createWebCitationCounter(startIndex = 1): WebCitationCounter {
  return { nextIndex: Math.max(1, Math.trunc(startIndex)) };
}

export function isWebCitationToolName(name: string | undefined): boolean {
  if (!name) return false;
  const normalized = name.trim().toLowerCase().replace(/_/g, '');
  return normalized === 'websearch' || normalized === 'webfetch';
}

export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

export function buildWebCitationIndexBlock(
  items: Array<{ title: string; url: string }>,
  startIndex = 1
): { block: string; sources: WebCitationSource[]; nextIndex: number } {
  const sources: WebCitationSource[] = [];
  let index = Math.max(1, Math.trunc(startIndex));

  for (const item of items) {
    const url = item.url.trim();
    if (!url) continue;
    const title = item.title.trim() || hostnameFromUrl(url);
    sources.push({ index, title, url });
    index += 1;
  }

  if (sources.length === 0) {
    return { block: '', sources, nextIndex: Math.max(1, Math.trunc(startIndex)) };
  }

  const lines = [WEB_CITATION_INDEX_PREFIX, ...sources.map((s) => `[${s.index}] ${s.title} — ${s.url}`)];
  return { block: lines.join('\n'), sources, nextIndex: index };
}

/** Prepend a Source index block when there are citeable URLs. */
export function prependWebCitationIndex(
  body: string,
  items: Array<{ title: string; url: string }>,
  startIndex = 1
): { text: string; sources: WebCitationSource[]; nextIndex: number } {
  const { block, sources, nextIndex } = buildWebCitationIndexBlock(items, startIndex);
  if (!block) {
    return { text: body, sources, nextIndex };
  }
  const trimmedBody = body.replace(/^\s+/, '');
  return {
    text: trimmedBody ? `${block}\n\n${trimmedBody}` : block,
    sources,
    nextIndex,
  };
}

export function allocateWebCitationIndex(
  counter: WebCitationCounter | undefined,
  items: Array<{ title: string; url: string }>,
  body: string
): string {
  const startIndex = counter?.nextIndex ?? 1;
  const { text, nextIndex } = prependWebCitationIndex(body, items, startIndex);
  if (counter) {
    counter.nextIndex = nextIndex;
  }
  return text;
}

/**
 * Extract numbered sources from a tool result / trace toolOutput.
 * Only lines under a `Source index:` block (until a blank line or non-matching line) count.
 */
export function extractWebCitationSources(toolOutput: string | undefined): WebCitationSource[] {
  if (!toolOutput) return [];

  const lines = toolOutput.split(/\r?\n/);
  const sources: WebCitationSource[] = [];
  let inIndex = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inIndex) {
      if (trimmed === WEB_CITATION_INDEX_PREFIX) {
        inIndex = true;
      }
      continue;
    }

    if (!trimmed) {
      break;
    }

    const match = CITATION_LINE_RE.exec(trimmed);
    if (!match) {
      break;
    }

    const index = Number.parseInt(match[1] ?? '', 10);
    const title = (match[2] ?? '').trim();
    const url = (match[3] ?? '').trim();
    if (!Number.isFinite(index) || index < 1 || !url) {
      continue;
    }
    sources.push({ index, title: title || hostnameFromUrl(url), url });
  }

  return sources;
}

export function extractWebCitationSourcesFromTraceStep(step: {
  toolName?: string;
  toolOutput?: string;
  content?: string;
  type?: string;
}): WebCitationSource[] {
  if (!isWebCitationToolName(step.toolName)) {
    return [];
  }
  const fromOutput = extractWebCitationSources(step.toolOutput);
  if (fromOutput.length > 0) {
    return fromOutput;
  }
  return extractWebCitationSources(step.content);
}

/** Merge sources by index; first occurrence wins (stable turn order). */
export function mergeWebCitationSources(
  batches: WebCitationSource[][]
): WebCitationSource[] {
  const byIndex = new Map<number, WebCitationSource>();
  for (const batch of batches) {
    for (const source of batch) {
      if (!byIndex.has(source.index)) {
        byIndex.set(source.index, source);
      }
    }
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

export function extractCitedIndices(text: string): number[] {
  const found = new Set<number>();
  INLINE_CITATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_CITATION_RE.exec(text)) !== null) {
    const index = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(index) && index >= 1) {
      found.add(index);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Turn `[n]` into markdown links when `n` maps to a known source URL.
 * Does nothing when the map is empty (avoids false positives like "tableau [1]").
 */
export function linkifyCitationMarkers(
  text: string,
  sourcesByIndex: ReadonlyMap<number, string>
): string {
  if (!text || sourcesByIndex.size === 0) {
    return text;
  }

  return text.replace(INLINE_CITATION_RE, (full, rawIndex: string, offset: number) => {
    // Skip markdown links already of the form [label](url) — if `[n]` is followed by `(`.
    const after = text.slice(offset + full.length, offset + full.length + 1);
    if (after === '(') {
      return full;
    }

    const index = Number.parseInt(rawIndex, 10);
    const url = sourcesByIndex.get(index);
    if (!url || !/^(?:https?:)/i.test(url)) {
      return full;
    }
    return `[[${index}]](${url})`;
  });
}

export function sourcesByIndexMap(
  sources: WebCitationSource[]
): Map<number, string> {
  const map = new Map<number, string>();
  for (const source of sources) {
    if (!map.has(source.index)) {
      map.set(source.index, source.url);
    }
  }
  return map;
}
