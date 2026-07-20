import {
  SEMANTIC_CHUNK_LINE_COUNT,
  SEMANTIC_CHUNK_OVERLAP_LINES,
  SEMANTIC_EXCERPT_MAX_CHARS,
} from './constants';

export interface TextChunk {
  /** 1-based start line in the source file. */
  startLine: number;
  /** 1-based inclusive end line. */
  endLine: number;
  text: string;
}

export interface ChunkTextOptions {
  linesPerChunk?: number;
  overlapLines?: number;
}

/**
 * Split file content into overlapping line blocks.
 * Empty content yields no chunks. Overlap is clamped to keep a positive stride.
 */
export function chunkTextByLines(content: string, options: ChunkTextOptions = {}): TextChunk[] {
  const linesPerChunk = Math.max(1, options.linesPerChunk ?? SEMANTIC_CHUNK_LINE_COUNT);
  const requestedOverlap = Math.max(0, options.overlapLines ?? SEMANTIC_CHUNK_OVERLAP_LINES);
  const overlapLines = Math.min(requestedOverlap, linesPerChunk - 1);
  const stride = linesPerChunk - overlapLines;

  // Preserve trailing empty line only when the file ends with a newline and has content.
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized) {
    return [];
  }
  const lines = normalized.split('\n');
  // A final empty segment from a trailing newline is kept as an empty line only if
  // there is at least one prior line; pure "" already returned above.
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length === 0) {
    return [];
  }

  const chunks: TextChunk[] = [];
  for (let startIndex = 0; startIndex < lines.length; startIndex += stride) {
    const endIndex = Math.min(startIndex + linesPerChunk, lines.length);
    const slice = lines.slice(startIndex, endIndex);
    chunks.push({
      startLine: startIndex + 1,
      endLine: endIndex,
      text: slice.join('\n'),
    });
    if (endIndex >= lines.length) {
      break;
    }
  }
  return chunks;
}

/** Truncate chunk text for hit excerpts without breaking mid-code too aggressively. */
export function excerptFromChunkText(text: string, maxChars = SEMANTIC_EXCERPT_MAX_CHARS): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
