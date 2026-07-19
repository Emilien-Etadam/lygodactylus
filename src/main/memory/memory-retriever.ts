import type { MemoryRerankerConfig } from '../config/config-schema';
import type {
  CoreMemoryEntry,
  MemoryReadResult,
  MemorySearchParams,
  MemorySearchResult,
  SessionMemoryItem,
} from './memory-types';
import { ExperienceMemoryStore } from './experience-memory-store';
import { computeMemoryRankScore } from './memory-ranker';
import { maybeRerankMemoryItems } from './memory-reranker-client';
import { lexicalScore, normalizeWorkspaceKey, summarizeText } from './memory-utils';

function buildSearchId(kind: string, recordId: string): string {
  return `${kind}|${encodeURIComponent(recordId)}`;
}

function parseSearchId(id: string): { kind: string; recordId: string } | null {
  const separator = id.indexOf('|');
  if (separator <= 0) {
    return null;
  }
  return {
    kind: id.slice(0, separator),
    recordId: decodeURIComponent(id.slice(separator + 1)),
  };
}

function buildSourceExcerpt(
  rawSession: SessionMemoryItem['rawSession'] | undefined,
  sourceTurns: number[] | undefined
): string | undefined {
  if (!rawSession?.length || !sourceTurns?.length) {
    return undefined;
  }
  const turns = sourceTurns
    .map((index) => rawSession[index])
    .filter((turn): turn is NonNullable<typeof turn> => Boolean(turn));
  if (!turns.length) {
    return undefined;
  }
  return summarizeText(turns.map((turn) => `${turn.role}: ${turn.content}`).join('\n'), 320);
}

interface RankedSearchHit {
  result: MemorySearchResult;
  baseScore: number;
  freshnessFactor: number;
  confidenceFactor: number;
  documentText: string;
  score: number;
}

export class MemoryRetriever {
  constructor(
    private readonly deps: {
      getCoreEntries: () => CoreMemoryEntry[];
      getCoreFilePath: () => string;
      getExperienceStore: () => ExperienceMemoryStore;
      getExperienceFilePath: () => string;
      getSessionTitle: (sessionId: string) => string | undefined;
      embedQuery?: (query: string) => Promise<number[]>;
      useEmbedding?: () => boolean;
      getRerankerConfig?: () => MemoryRerankerConfig;
      rerankFetch?: typeof fetch;
    }
  ) {}

  async search(params: MemorySearchParams): Promise<MemorySearchResult[]> {
    const query = params.query.trim();
    if (!query) {
      return [];
    }

    const defaultWorkspace = normalizeWorkspaceKey(params.workspaceKey ?? params.cwd ?? null);
    const explicitSourceWorkspace =
      params.sourceWorkspace !== undefined ? normalizeWorkspaceKey(params.sourceWorkspace) : null;
    const scope = params.scope || (defaultWorkspace ? 'workspace' : 'all');
    const experienceWorkspace =
      explicitSourceWorkspace ?? (scope === 'workspace' ? defaultWorkspace : null);
    const limit = Math.min(Math.max(params.limit || 8, 1), 50);
    const queryEmbedding =
      this.deps.useEmbedding?.() && this.deps.embedQuery
        ? await this.deps.embedQuery(query)
        : undefined;
    const hits: RankedSearchHit[] = [];

    if (scope !== 'workspace') {
      hits.push(...this.searchCore(query));
    }
    if (scope !== 'global') {
      hits.push(
        ...(await this.searchExperience(
          query,
          experienceWorkspace,
          defaultWorkspace,
          queryEmbedding
        ))
      );
    }

    // Classement actuel (evidence + workspace + fraîcheur × confiance).
    const ranked = hits.sort(
      (a, b) =>
        b.score - a.score ||
        (b.result.updatedAt || b.result.createdAt) - (a.result.updatedAt || a.result.createdAt)
    );

    const reranker = this.deps.getRerankerConfig?.();
    if (!reranker?.enabled) {
      return ranked.slice(0, limit).map((hit) => ({ ...hit.result, score: hit.score }));
    }

    // Rerank = pertinence sémantique sur le top-N ; fraîcheur/confiance restent
    // multiplicatifs sur le score final (voir applyRerankHits). En échec → ordre inchangé.
    const reranked = await maybeRerankMemoryItems({
      enabled: true,
      config: reranker,
      query,
      items: ranked.map((hit) => ({
        ...hit,
        documentText: hit.documentText,
        score: hit.score,
        freshnessFactor: hit.freshnessFactor,
        confidenceFactor: hit.confidenceFactor,
      })),
      fetchImpl: this.deps.rerankFetch,
      logLabel: 'search',
    });

    return reranked.slice(0, limit).map((hit) => ({
      ...hit.result,
      score: hit.score,
    }));
  }

  read(id: string): MemoryReadResult | null {
    const parsed = parseSearchId(id);
    if (!parsed) {
      return null;
    }
    if (parsed.kind === 'core') {
      return this.readCore(parsed.recordId);
    }

    const store = this.deps.getExperienceStore();
    if (parsed.kind === 'experience_chunk') {
      const chunk = store.getChunk(parsed.recordId);
      if (!chunk) {
        return null;
      }
      const session = store.getSession(chunk.sessionId);
      return {
        id,
        recordId: parsed.recordId,
        kind: 'experience_chunk',
        title: chunk.summary || chunk.sourceSessionTitle || 'Chunk memory',
        summary: chunk.summary,
        contentPreview: summarizeText(chunk.details || chunk.rawText, 220),
        rawText: chunk.rawText,
        details: chunk.details,
        sourceTurns: chunk.sourceTurns,
        sourceWorkspace: chunk.sourceWorkspace,
        sourceWorkspaceLabel: chunk.sourceWorkspaceLabel,
        workspaceKey: chunk.sourceWorkspace || undefined,
        sourceSessionId: chunk.sourceSessionId,
        sourceSessionTitle: chunk.sourceSessionTitle,
        sessionId: chunk.sessionId,
        sessionTitle: this.deps.getSessionTitle(chunk.sessionId),
        sourceFile: this.deps.getExperienceFilePath(),
        score: 0,
        createdAt: Date.parse(chunk.createdAt) || Date.now(),
        updatedAt: Date.parse(chunk.ingestedAt) || undefined,
        keywords: chunk.keywords,
        sourceExcerpt: buildSourceExcerpt(session?.rawSession, chunk.sourceTurns),
      };
    }

    const session = store.getSession(parsed.recordId);
    if (!session) {
      return null;
    }
    const chunks = store.getChunksBySession(session.sessionId);
    const rawText = session.rawSession.map((turn) => `${turn.role}: ${turn.content}`).join('\n');
    return {
      id,
      recordId: parsed.recordId,
      kind: parsed.kind === 'raw_session' ? 'raw_session' : 'experience_session',
      title:
        session.sourceSessionTitle ||
        this.deps.getSessionTitle(session.sessionId) ||
        session.summary ||
        'Session memory',
      summary: session.summary,
      contentPreview:
        parsed.kind === 'raw_session'
          ? summarizeText(rawText, 220)
          : summarizeText(session.summary, 220),
      rawText,
      rawSession: session.rawSession,
      sourceWorkspace: session.sourceWorkspace,
      sourceWorkspaceLabel: session.sourceWorkspaceLabel,
      workspaceKey: session.sourceWorkspace || undefined,
      sourceSessionId: session.sourceSessionId,
      sourceSessionTitle: session.sourceSessionTitle,
      sessionId: session.sessionId,
      sessionTitle: this.deps.getSessionTitle(session.sessionId),
      sourceFile: this.deps.getExperienceFilePath(),
      score: 0,
      createdAt: Date.parse(session.createdAt) || Date.now(),
      updatedAt: Date.parse(session.ingestedAt) || undefined,
      keywords: session.keywords,
      chunkIds: chunks.map((chunk) => chunk.id),
      sourceExcerpt: summarizeText(rawText, 320),
    };
  }

  private searchCore(query: string): RankedSearchHit[] {
    return this.deps
      .getCoreEntries()
      .map((entry): RankedSearchHit | null => {
        const score = lexicalScore(query, `${entry.combinedKey} ${entry.value}`);
        if (score <= 0) {
          return null;
        }
        const result: MemorySearchResult = {
          id: buildSearchId('core', entry.combinedKey),
          recordId: entry.combinedKey,
          kind: 'core',
          title: entry.combinedKey,
          summary: entry.value,
          contentPreview: summarizeText(entry.value, 220),
          category: entry.category,
          sourceFile: this.deps.getCoreFilePath(),
          score,
          createdAt: 0,
          updatedAt: 0,
        };
        return {
          result,
          baseScore: score,
          freshnessFactor: 1,
          confidenceFactor: 1,
          documentText: `${entry.combinedKey}\n${entry.value}`,
          score,
        };
      })
      .filter((item): item is RankedSearchHit => Boolean(item));
  }

  private async searchExperience(
    query: string,
    sourceWorkspace: string | null,
    currentWorkspace: string | null,
    queryEmbedding?: number[]
  ): Promise<RankedSearchHit[]> {
    const store = this.deps.getExperienceStore();
    const results: RankedSearchHit[] = [];

    for (const item of store.sessions) {
      if (sourceWorkspace && item.sourceWorkspace !== sourceWorkspace) {
        continue;
      }
      const text = [
        item.summary,
        ...item.keywords,
        item.sourceWorkspace || '',
        item.sourceSessionTitle || '',
      ].join(' ');
      const ranked = computeMemoryRankScore({
        query,
        text,
        queryEmbedding,
        recordEmbedding: item.embedding,
        currentWorkspace,
        sourceWorkspace: item.sourceWorkspace,
        createdAt: item.createdAt,
        ingestedAt: item.ingestedAt,
        confidence: item.confidence,
      });
      if (ranked.evidenceScore <= 0) {
        continue;
      }
      const result = this.mapSessionResult(item, ranked.score);
      results.push({
        result,
        baseScore: ranked.baseScore,
        freshnessFactor: ranked.freshnessFactor,
        confidenceFactor: ranked.confidenceFactor,
        documentText: text,
        score: ranked.score,
      });
    }

    for (const item of store.chunks) {
      if (sourceWorkspace && item.sourceWorkspace !== sourceWorkspace) {
        continue;
      }
      const text = [item.summary, item.details, item.rawText, ...item.keywords].join(' ');
      const ranked = computeMemoryRankScore({
        query,
        text,
        queryEmbedding,
        recordEmbedding: item.embedding,
        currentWorkspace,
        sourceWorkspace: item.sourceWorkspace,
        createdAt: item.createdAt,
        ingestedAt: item.ingestedAt,
        confidence: item.confidence,
      });
      if (ranked.evidenceScore <= 0) {
        continue;
      }
      const result: MemorySearchResult = {
        id: buildSearchId('experience_chunk', item.id),
        recordId: item.id,
        kind: 'experience_chunk',
        title: item.summary || 'Chunk memory',
        summary: item.summary,
        contentPreview: summarizeText(item.details || item.rawText, 220),
        workspaceKey: item.sourceWorkspace || undefined,
        sourceWorkspace: item.sourceWorkspace,
        sourceWorkspaceLabel: item.sourceWorkspaceLabel,
        sourceSessionId: item.sourceSessionId,
        sourceSessionTitle: item.sourceSessionTitle,
        sessionId: item.sessionId,
        sessionTitle: this.deps.getSessionTitle(item.sessionId),
        score: ranked.score,
        createdAt: Date.parse(item.createdAt) || Date.now(),
        updatedAt: Date.parse(item.ingestedAt) || undefined,
        keywords: item.keywords,
        sourceFile: this.deps.getExperienceFilePath(),
      };
      results.push({
        result,
        baseScore: ranked.baseScore,
        freshnessFactor: ranked.freshnessFactor,
        confidenceFactor: ranked.confidenceFactor,
        documentText: text,
        score: ranked.score,
      });
    }
    return results;
  }

  private mapSessionResult(item: SessionMemoryItem, score: number): MemorySearchResult {
    return {
      id: buildSearchId('experience_session', item.sessionId),
      recordId: item.sessionId,
      kind: 'experience_session',
      title:
        item.sourceSessionTitle ||
        this.deps.getSessionTitle(item.sessionId) ||
        item.summary ||
        'Session memory',
      summary: item.summary,
      contentPreview: summarizeText(item.summary, 220),
      workspaceKey: item.sourceWorkspace || undefined,
      sourceWorkspace: item.sourceWorkspace,
      sourceWorkspaceLabel: item.sourceWorkspaceLabel,
      sourceSessionId: item.sourceSessionId,
      sourceSessionTitle: item.sourceSessionTitle,
      sessionId: item.sessionId,
      sessionTitle: this.deps.getSessionTitle(item.sessionId),
      score,
      createdAt: Date.parse(item.createdAt) || Date.now(),
      updatedAt: Date.parse(item.ingestedAt) || undefined,
      keywords: item.keywords,
      sourceFile: this.deps.getExperienceFilePath(),
    };
  }

  private readCore(combinedKey: string): MemoryReadResult | null {
    const entry = this.deps.getCoreEntries().find((item) => item.combinedKey === combinedKey);
    if (!entry) {
      return null;
    }
    return {
      id: buildSearchId('core', entry.combinedKey),
      recordId: entry.combinedKey,
      kind: 'core',
      title: entry.combinedKey,
      summary: entry.value,
      contentPreview: summarizeText(entry.value, 220),
      rawText: entry.value,
      category: entry.category,
      score: 0,
      createdAt: 0,
      updatedAt: 0,
      sourceFile: this.deps.getCoreFilePath(),
    };
  }
}
