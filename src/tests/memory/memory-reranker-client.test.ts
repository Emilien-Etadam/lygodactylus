import { describe, expect, it, vi } from 'vitest';
import {
  MemoryRerankerError,
  applyRerankHits,
  parseRerankResponse,
  rerankDocuments,
} from '../../main/memory/memory-reranker-client';

describe('parseRerankResponse', () => {
  it('parses results[{index,relevance_score}] format', () => {
    const hits = parseRerankResponse(
      {
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.2 },
        ],
      },
      2
    );
    expect(hits.map((hit) => hit.index)).toEqual([1, 0]);
    expect(hits[0].relevanceScore).toBe(0.9);
  });

  it('parses scores[] format aligned with documents', () => {
    const hits = parseRerankResponse({ scores: [0.1, 0.8, 0.4] }, 3);
    expect(hits.map((hit) => hit.index)).toEqual([1, 2, 0]);
  });

  it('rejects unknown payloads', () => {
    expect(() => parseRerankResponse({ ok: true }, 1)).toThrow(MemoryRerankerError);
  });
});

describe('rerankDocuments', () => {
  it('posts to /v1/rerank and returns ranked hits', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe('http://127.0.0.1:8080/v1/rerank');
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        model: 'rerank-mini',
        query: 'cats',
        documents: ['about dogs', 'about cats'],
      });
      return new Response(JSON.stringify({ scores: [0.2, 0.95] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const hits = await rerankDocuments({
      baseUrl: 'http://127.0.0.1:8080',
      model: 'rerank-mini',
      query: 'cats',
      documents: ['about dogs', 'about cats'],
      timeoutMs: 800,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(hits[0]).toEqual({ index: 1, relevanceScore: 0.95 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws a typed timeout error', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error('missing abort signal'));
          return;
        }
        const rejectAbort = () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (signal.aborted) {
          rejectAbort();
          return;
        }
        signal.addEventListener('abort', rejectAbort, { once: true });
      });
    });

    let caught: unknown;
    try {
      await rerankDocuments({
        baseUrl: 'http://127.0.0.1:8080',
        model: 'rerank-mini',
        query: 'q',
        documents: ['a'],
        timeoutMs: 40,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MemoryRerankerError);
    expect((caught as MemoryRerankerError).code).toBe('timeout');
  });
});

describe('applyRerankHits', () => {
  it('reorders and truncates to keep, applying freshness/confidence multipliers', () => {
    const ordered = applyRerankHits(
      [
        { documentText: 'a', score: 1, freshnessFactor: 0.5, confidenceFactor: 1 },
        { documentText: 'b', score: 1, freshnessFactor: 1, confidenceFactor: 0.5 },
        { documentText: 'c', score: 1, freshnessFactor: 1, confidenceFactor: 1 },
      ],
      [
        { index: 2, relevanceScore: 0.9 },
        { index: 0, relevanceScore: 0.8 },
        { index: 1, relevanceScore: 0.7 },
      ],
      2
    );
    expect(ordered.map((item) => item.documentText)).toEqual(['c', 'a']);
    expect(ordered[0].score).toBeCloseTo(0.9);
    expect(ordered[1].score).toBeCloseTo(0.4);
  });
});
