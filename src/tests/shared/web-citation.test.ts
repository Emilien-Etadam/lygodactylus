import { describe, expect, it } from 'vitest';
import {
  WEB_CITATION_INDEX_PREFIX,
  allocateWebCitationIndex,
  buildWebCitationIndexBlock,
  createWebCitationCounter,
  extractCitedIndices,
  extractWebCitationSources,
  extractWebCitationSourcesFromTraceStep,
  linkifyCitationMarkers,
  mergeWebCitationSources,
  prependWebCitationIndex,
  sourcesByIndexMap,
} from '../../shared/web-citation';
import { formatWebSearchResponse, type WebSearchResponse } from '../../shared/web-search';

describe('web-citation index formatting', () => {
  it('builds a stable Source index block with [n] title — url lines', () => {
    const { block, sources, nextIndex } = buildWebCitationIndexBlock(
      [
        { title: 'Alpha', url: 'https://a.example/1' },
        { title: 'Beta', url: 'https://b.example/2' },
      ],
      1
    );
    expect(block.startsWith(WEB_CITATION_INDEX_PREFIX)).toBe(true);
    expect(block).toContain('[1] Alpha — https://a.example/1');
    expect(block).toContain('[2] Beta — https://b.example/2');
    expect(sources).toHaveLength(2);
    expect(nextIndex).toBe(3);
  });

  it('skips items without URL and continues numbering', () => {
    const { sources, nextIndex } = buildWebCitationIndexBlock(
      [
        { title: 'NoUrl', url: '' },
        { title: 'Ok', url: 'https://ok.example' },
      ],
      5
    );
    expect(sources).toEqual([{ index: 5, title: 'Ok', url: 'https://ok.example' }]);
    expect(nextIndex).toBe(6);
  });

  it('prepends the index before the tool body', () => {
    const { text } = prependWebCitationIndex('Query: test\nResults:\n- x', [
      { title: 'X', url: 'https://x.test' },
    ]);
    expect(text.startsWith(`${WEB_CITATION_INDEX_PREFIX}\n[1] X — https://x.test\n\nQuery:`)).toBe(
      true
    );
  });

  it('allocates turn-wide numbers via a shared counter', () => {
    const counter = createWebCitationCounter();
    const first = allocateWebCitationIndex(
      counter,
      [{ title: 'One', url: 'https://one.test' }],
      'body-a'
    );
    const second = allocateWebCitationIndex(
      counter,
      [{ title: 'Two', url: 'https://two.test' }],
      'body-b'
    );
    expect(first).toContain('[1] One — https://one.test');
    expect(second).toContain('[2] Two — https://two.test');
    expect(counter.nextIndex).toBe(3);
  });
});

describe('web-citation extraction from tool output / trace steps', () => {
  const sampleOutput = `${WEB_CITATION_INDEX_PREFIX}
[1] Hugging Face Papers — https://huggingface.co/papers
[2] OpenReview — https://openreview.net/

Query: agent papers
Results:
- Hugging Face Papers (https://huggingface.co/papers)`;

  it('extracts sources from a Source index block', () => {
    expect(extractWebCitationSources(sampleOutput)).toEqual([
      { index: 1, title: 'Hugging Face Papers', url: 'https://huggingface.co/papers' },
      { index: 2, title: 'OpenReview', url: 'https://openreview.net/' },
    ]);
  });

  it('extracts sources from a simulated web_search trace step', () => {
    const sources = extractWebCitationSourcesFromTraceStep({
      type: 'tool_call',
      toolName: 'web_search',
      toolOutput: sampleOutput.slice(0, 800),
    });
    expect(sources).toHaveLength(2);
    expect(sources[0]?.url).toBe('https://huggingface.co/papers');
  });

  it('extracts sources from a simulated web_fetch trace step', () => {
    const sources = extractWebCitationSourcesFromTraceStep({
      type: 'tool_call',
      toolName: 'web_fetch',
      toolOutput: `${WEB_CITATION_INDEX_PREFIX}
[3] example.com — https://example.com/doc

URL: https://example.com/doc
Status: 200`,
    });
    expect(sources).toEqual([{ index: 3, title: 'example.com', url: 'https://example.com/doc' }]);
  });

  it('ignores non-web tool steps', () => {
    expect(
      extractWebCitationSourcesFromTraceStep({
        toolName: 'bash',
        toolOutput: sampleOutput,
      })
    ).toEqual([]);
  });

  it('merges batches by index with first-wins', () => {
    expect(
      mergeWebCitationSources([
        [{ index: 1, title: 'A', url: 'https://a.test' }],
        [
          { index: 1, title: 'A-dup', url: 'https://a-dup.test' },
          { index: 2, title: 'B', url: 'https://b.test' },
        ],
      ])
    ).toEqual([
      { index: 1, title: 'A', url: 'https://a.test' },
      { index: 2, title: 'B', url: 'https://b.test' },
    ]);
  });
});

describe('web-citation inline markers', () => {
  it('maps [n] to url', () => {
    const map = sourcesByIndexMap([
      { index: 1, title: 'A', url: 'https://a.test' },
      { index: 2, title: 'B', url: 'https://b.test' },
    ]);
    expect(map.get(1)).toBe('https://a.test');
    expect(map.get(2)).toBe('https://b.test');
  });

  it('linkifies [n] when sources exist', () => {
    const map = sourcesByIndexMap([{ index: 1, title: 'A', url: 'https://a.test' }]);
    expect(linkifyCitationMarkers('Selon [1], le modèle est récent.', map)).toBe(
      'Selon [[1]](https://a.test), le modèle est récent.'
    );
  });

  it('does not linkify when there are no sources (false positive guard)', () => {
    const text = 'Voir le tableau [1] pour les détails.';
    expect(linkifyCitationMarkers(text, new Map())).toBe(text);
  });

  it('does not linkify unknown indices even when other sources exist', () => {
    const map = sourcesByIndexMap([{ index: 2, title: 'B', url: 'https://b.test' }]);
    expect(linkifyCitationMarkers('tableau [1] et source [2]', map)).toBe(
      'tableau [1] et source [[2]](https://b.test)'
    );
  });

  it('extracts cited indices from assistant text', () => {
    expect(extractCitedIndices('A [1] then [3] and [1] again')).toEqual([1, 3]);
  });

  it('leaves existing markdown links alone', () => {
    const map = sourcesByIndexMap([{ index: 1, title: 'A', url: 'https://a.test' }]);
    expect(linkifyCitationMarkers('[1](https://already.test) and [1]', map)).toBe(
      '[1](https://already.test) and [[1]](https://a.test)'
    );
  });
});

describe('formatWebSearchResponse citation index', () => {
  it('prepends Source index for results with URLs', () => {
    const response: WebSearchResponse = {
      query: 'q',
      provider: 'searxng',
      sourceLabel: 'SearXNG',
      results: [
        { title: 'One', url: 'https://one.test', snippet: 's' },
        { title: 'Two', url: 'https://two.test' },
      ],
    };
    const text = formatWebSearchResponse(response);
    expect(text.startsWith(WEB_CITATION_INDEX_PREFIX)).toBe(true);
    expect(text).toContain('[1] One — https://one.test');
    expect(text).toContain('[2] Two — https://two.test');
    expect(text).toContain('Query: q');
  });
});
