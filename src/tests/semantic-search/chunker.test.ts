import { describe, expect, it } from 'vitest';
import { chunkTextByLines, excerptFromChunkText } from '../../main/semantic-search/chunker';

describe('chunkTextByLines', () => {
  it('returns empty for empty content', () => {
    expect(chunkTextByLines('')).toEqual([]);
  });

  it('chunks with configured size and overlap', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line-${i + 1}`);
    const chunks = chunkTextByLines(lines.join('\n'), {
      linesPerChunk: 60,
      overlapLines: 10,
    });

    expect(chunks.length).toBe(2);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(60);
    expect(chunks[1].startLine).toBe(51); // 60 - 10 + 1
    expect(chunks[1].endLine).toBe(100);
    expect(chunks[0].text.split('\n')).toHaveLength(60);
    expect(chunks[1].text.startsWith('line-51')).toBe(true);
  });

  it('clamps overlap so stride stays positive', () => {
    const lines = Array.from({ length: 5 }, (_, i) => `L${i + 1}`);
    const chunks = chunkTextByLines(lines.join('\n'), {
      linesPerChunk: 3,
      overlapLines: 99,
    });
    // overlap becomes 2 → stride 1
    expect(chunks.length).toBe(3);
    expect(chunks.map((c) => c.startLine)).toEqual([1, 2, 3]);
  });

  it('handles content shorter than one chunk', () => {
    const chunks = chunkTextByLines('a\nb\nc', { linesPerChunk: 60, overlapLines: 10 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ startLine: 1, endLine: 3, text: 'a\nb\nc' });
  });
});

describe('excerptFromChunkText', () => {
  it('truncates long excerpts', () => {
    const long = 'word '.repeat(200);
    const excerpt = excerptFromChunkText(long, 40);
    expect(excerpt.length).toBeLessThanOrEqual(40);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});
