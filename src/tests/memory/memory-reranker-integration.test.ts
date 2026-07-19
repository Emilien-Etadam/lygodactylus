import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemoryRerankerConfig } from '../../main/config/config-schema';
import { ExperienceMemoryStore } from '../../main/memory/experience-memory-store';
import { MemoryRetriever } from '../../main/memory/memory-retriever';

const NOW = '2026-07-19T12:00:00.000Z';

function makeReranker(overrides: Partial<MemoryRerankerConfig> = {}): MemoryRerankerConfig {
  return {
    enabled: true,
    baseUrl: 'http://127.0.0.1:8080',
    model: 'rerank-mini',
    topN: 20,
    keep: 2,
    timeoutMs: 800,
    ...overrides,
  };
}

function seedStore(filePath: string): ExperienceMemoryStore {
  fs.writeFileSync(filePath, JSON.stringify({ sessions: [], chunks: [] }), 'utf8');
  const store = new ExperienceMemoryStore(filePath);
  const workspace = '/workspace/demo';

  // Tous matchent « project alpha » ; A est le plus riche lexicalement (gateway token).
  store.replaceSession(
    'sess-a',
    {
      sessionId: 'sess-a',
      sourceWorkspace: workspace,
      sourceWorkspaceLabel: 'demo',
      sourceSessionId: 'sess-a',
      sourceSessionTitle: 'Gateway work',
      summary: 'project alpha gateway token rotation notes',
      keywords: ['project', 'alpha', 'gateway', 'token'],
      chunkIds: [],
      rawSession: [],
      sessionDate: '2026-07-01',
      createdAt: NOW,
      ingestedAt: NOW,
      embedding: [],
    },
    [
      {
        id: 'chunk-a',
        sessionId: 'sess-a',
        sourceWorkspace: workspace,
        sourceSessionId: 'sess-a',
        sourceSessionTitle: 'Gateway work',
        summary: 'project alpha gateway token rotation implementation details',
        details: 'project alpha gateway token rotation',
        keywords: ['project', 'alpha', 'gateway', 'token', 'rotation'],
        sourceTurns: [],
        rawText: 'project alpha gateway token rotation implementation details',
        sessionDate: '2026-07-01',
        createdAt: NOW,
        ingestedAt: NOW,
        embedding: [],
      },
    ]
  );

  store.replaceSession(
    'sess-b',
    {
      sessionId: 'sess-b',
      sourceWorkspace: workspace,
      sourceWorkspaceLabel: 'demo',
      sourceSessionId: 'sess-b',
      sourceSessionTitle: 'Cats notes',
      summary: 'project alpha notes about cats and pets',
      keywords: ['project', 'alpha', 'cats'],
      chunkIds: [],
      rawSession: [],
      sessionDate: '2026-07-01',
      createdAt: NOW,
      ingestedAt: NOW,
      embedding: [],
    },
    [
      {
        id: 'chunk-b',
        sessionId: 'sess-b',
        sourceWorkspace: workspace,
        sourceSessionId: 'sess-b',
        sourceSessionTitle: 'Cats notes',
        summary: 'project alpha cats prefer sunny windowsills',
        details: 'project alpha cats prefer sunny windowsills',
        keywords: ['project', 'alpha', 'cats'],
        sourceTurns: [],
        rawText: 'project alpha cats prefer sunny windowsills',
        sessionDate: '2026-07-01',
        createdAt: NOW,
        ingestedAt: NOW,
        embedding: [],
      },
    ]
  );

  store.replaceSession(
    'sess-c',
    {
      sessionId: 'sess-c',
      sourceWorkspace: workspace,
      sourceWorkspaceLabel: 'demo',
      sourceSessionId: 'sess-c',
      sourceSessionTitle: 'Garden',
      summary: 'project alpha gardening tips',
      keywords: ['project', 'alpha', 'garden'],
      chunkIds: [],
      rawSession: [],
      sessionDate: '2026-07-01',
      createdAt: NOW,
      ingestedAt: NOW,
      embedding: [],
    },
    [
      {
        id: 'chunk-c',
        sessionId: 'sess-c',
        sourceWorkspace: workspace,
        sourceSessionId: 'sess-c',
        sourceSessionTitle: 'Garden',
        summary: 'project alpha tomato watering schedule',
        details: 'project alpha tomato watering schedule',
        keywords: ['project', 'alpha', 'tomato'],
        sourceTurns: [],
        rawText: 'project alpha tomato watering schedule',
        sessionDate: '2026-07-01',
        createdAt: NOW,
        ingestedAt: NOW,
        embedding: [],
      },
    ]
  );

  return store;
}

describe('MemoryRetriever local rerank integration', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function setup(reranker: MemoryRerankerConfig, fetchImpl?: typeof fetch) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-rerank-'));
    tempDirs.push(dir);
    const store = seedStore(path.join(dir, 'experience_memory.json'));
    const fetchSpy =
      fetchImpl ||
      (vi.fn(async () => {
        throw new Error('unexpected fetch');
      }) as unknown as typeof fetch);

    const retriever = new MemoryRetriever({
      getCoreEntries: () => [],
      getCoreFilePath: () => path.join(dir, 'core.json'),
      getExperienceStore: () => store,
      getExperienceFilePath: () => path.join(dir, 'experience_memory.json'),
      getSessionTitle: () => undefined,
      getRerankerConfig: () => reranker,
      rerankFetch: fetchSpy,
    });

    return { retriever, fetchSpy: fetchSpy as unknown as ReturnType<typeof vi.fn> };
  }

  it('reorders the top-N pool and truncates to keep when enabled', async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { documents: string[] };
      // Inverse l'ordre lexical : le document le moins bien classé lexicalement
      // pour "gateway token" parmi le top pool reçoit le meilleur score rerank.
      const scores = body.documents.map((doc) => {
        if (doc.includes('cats prefer')) return 0.99;
        if (doc.includes('gateway token')) return 0.8;
        if (doc.includes('cats')) return 0.55;
        return 0.1;
      });
      return new Response(JSON.stringify({ scores }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const { retriever } = setup(makeReranker({ topN: 10, keep: 2 }), fetchSpy as unknown as typeof fetch);
    const results = await retriever.search({
      query: 'project alpha gateway token',
      cwd: '/workspace/demo',
      scope: 'workspace',
      limit: 10,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results[0].summary.toLowerCase()).toContain('cats');
    expect(results[1].summary.toLowerCase()).toContain('gateway');
  });

  it('keeps the original order when the rerank call fails', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const disabled = setup(makeReranker({ enabled: false }));
    const baseline = await disabled.retriever.search({
      query: 'project alpha gateway token',
      cwd: '/workspace/demo',
      scope: 'workspace',
      limit: 10,
    });

    const { retriever, fetchSpy: spy } = setup(
      makeReranker({ topN: 10, keep: 2 }),
      fetchSpy as unknown as typeof fetch
    );
    const results = await retriever.search({
      query: 'project alpha gateway token',
      cwd: '/workspace/demo',
      scope: 'workspace',
      limit: 10,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(results.map((item) => item.recordId)).toEqual(baseline.map((item) => item.recordId));
    expect(results.map((item) => item.summary)).toEqual(baseline.map((item) => item.summary));
  });

  it('does not call the network when rerank is disabled', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('should not be called');
    });
    const { retriever, fetchSpy: spy } = setup(
      makeReranker({ enabled: false }),
      fetchSpy as unknown as typeof fetch
    );
    const results = await retriever.search({
      query: 'project alpha gateway token',
      cwd: '/workspace/demo',
      scope: 'workspace',
      limit: 5,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].summary.toLowerCase()).toContain('gateway');
  });
});
