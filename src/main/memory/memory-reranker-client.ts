/**
 * Client HTTP local pour POST /v1/rerank (style llama.cpp --reranking).
 * Opt-in, timeout strict, fallback à la charge de l'appelant.
 */

import type { MemoryRerankerConfig } from '../config/config-schema';
import { log } from '../utils/logger';

export type MemoryRerankerErrorCode = 'timeout' | 'http' | 'invalid_response' | 'config' | 'network';

export class MemoryRerankerError extends Error {
  readonly code: MemoryRerankerErrorCode;

  constructor(code: MemoryRerankerErrorCode, message: string) {
    super(message);
    this.name = 'MemoryRerankerError';
    this.code = code;
  }
}

export interface MemoryRerankRequest {
  baseUrl: string;
  model: string;
  query: string;
  documents: string[];
  timeoutMs: number;
  /** Injecté pour les tests. */
  fetchImpl?: typeof fetch;
}

export interface MemoryRerankHit {
  index: number;
  relevanceScore: number;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new MemoryRerankerError('config', 'Memory reranker baseUrl is empty');
  }
  // Accepte http://host:port ou …/v1 — évite /v1/v1/rerank
  if (trimmed.endsWith('/v1')) {
    return trimmed.slice(0, -3);
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Accepte les deux formats courants :
 * - { results: [{ index, relevance_score }] }
 * - { scores: number[] } (aligné sur l'ordre des documents)
 */
export function parseRerankResponse(payload: unknown, documentCount: number): MemoryRerankHit[] {
  if (!isRecord(payload)) {
    throw new MemoryRerankerError('invalid_response', 'Rerank response is not a JSON object');
  }

  if (Array.isArray(payload.results)) {
    const hits: MemoryRerankHit[] = [];
    for (const entry of payload.results) {
      if (!isRecord(entry)) {
        continue;
      }
      const index = toFiniteNumber(entry.index);
      const relevanceScore =
        toFiniteNumber(entry.relevance_score) ??
        toFiniteNumber(entry.relevanceScore) ??
        toFiniteNumber(entry.score);
      if (index === null || relevanceScore === null) {
        continue;
      }
      const roundedIndex = Math.round(index);
      if (roundedIndex < 0 || roundedIndex >= documentCount) {
        continue;
      }
      hits.push({ index: roundedIndex, relevanceScore });
    }
    if (hits.length === 0) {
      throw new MemoryRerankerError('invalid_response', 'Rerank results array is empty or invalid');
    }
    return hits.sort((a, b) => b.relevanceScore - a.relevanceScore || a.index - b.index);
  }

  if (Array.isArray(payload.scores)) {
    if (payload.scores.length !== documentCount) {
      throw new MemoryRerankerError(
        'invalid_response',
        `Rerank scores length (${payload.scores.length}) does not match documents (${documentCount})`
      );
    }
    const hits: MemoryRerankHit[] = [];
    for (let index = 0; index < payload.scores.length; index += 1) {
      const relevanceScore = toFiniteNumber(payload.scores[index]);
      if (relevanceScore === null) {
        throw new MemoryRerankerError('invalid_response', `Rerank score at index ${index} is invalid`);
      }
      hits.push({ index, relevanceScore });
    }
    return hits.sort((a, b) => b.relevanceScore - a.relevanceScore || a.index - b.index);
  }

  throw new MemoryRerankerError(
    'invalid_response',
    'Rerank response missing results[] or scores[]'
  );
}

export async function rerankDocuments(request: MemoryRerankRequest): Promise<MemoryRerankHit[]> {
  if (!request.documents.length) {
    return [];
  }
  const model = request.model.trim();
  if (!model) {
    throw new MemoryRerankerError('config', 'Memory reranker model is empty');
  }

  const root = normalizeBaseUrl(request.baseUrl);
  const url = `${root}/v1/rerank`;
  const timeoutMs = Math.max(100, request.timeoutMs);
  const fetchImpl = request.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref?.();

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        query: request.query,
        documents: request.documents,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new MemoryRerankerError(
        'http',
        `Rerank endpoint returned HTTP ${response.status}`
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new MemoryRerankerError('invalid_response', 'Rerank response is not valid JSON');
    }
    return parseRerankResponse(payload, request.documents.length);
  } catch (error) {
    if (error instanceof MemoryRerankerError) {
      throw error;
    }
    if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
      throw new MemoryRerankerError('timeout', `Rerank timed out after ${timeoutMs}ms`);
    }
    throw new MemoryRerankerError(
      'network',
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface RerankableMemoryItem {
  /** Texte envoyé au reranker. */
  documentText: string;
  /** Score courant (peut inclure fraîcheur/confiance). */
  score: number;
  /** Facteurs pour recalculer le score après rerank (multiplicatifs). */
  freshnessFactor?: number;
  confidenceFactor?: number;
}

/**
 * Réordonne `items` selon les hits du reranker et tronque à `keep`.
 * Met à jour `score` = relevance * freshness * confidence (fraîcheur/confiance
 * restent multiplicatifs par-dessus la pertinence sémantique du rerank).
 */
export function applyRerankHits<T extends RerankableMemoryItem>(
  items: T[],
  hits: MemoryRerankHit[],
  keep: number
): T[] {
  if (!items.length || !hits.length) {
    return items.slice(0, Math.max(1, keep));
  }
  const seen = new Set<number>();
  const ordered: T[] = [];
  for (const hit of hits) {
    if (seen.has(hit.index) || hit.index < 0 || hit.index >= items.length) {
      continue;
    }
    seen.add(hit.index);
    const item = items[hit.index];
    const freshness = item.freshnessFactor ?? 1;
    const confidence = item.confidenceFactor ?? 1;
    ordered.push({
      ...item,
      score: hit.relevanceScore * freshness * confidence,
    });
    if (ordered.length >= keep) {
      break;
    }
  }
  // Complète avec l'ordre d'origine si le reranker omet des index.
  if (ordered.length < keep) {
    for (let index = 0; index < items.length && ordered.length < keep; index += 1) {
      if (!seen.has(index)) {
        ordered.push(items[index]);
      }
    }
  }
  return ordered;
}

export async function maybeRerankMemoryItems<T extends RerankableMemoryItem>(options: {
  enabled: boolean;
  config: Pick<MemoryRerankerConfig, 'baseUrl' | 'model' | 'topN' | 'keep' | 'timeoutMs'>;
  query: string;
  items: T[];
  fetchImpl?: typeof fetch;
  logLabel?: string;
}): Promise<T[]> {
  if (!options.enabled || options.items.length === 0) {
    return options.items;
  }

  const { config, query, items } = options;
  if (!config.baseUrl.trim() || !config.model.trim()) {
    log(
      `[MemoryReranker] ${options.logLabel ?? 'rerank'} skipped: missing baseUrl/model (fallback)`
    );
    return items;
  }

  const topN = Math.min(Math.max(config.topN, 1), items.length);
  const keep = Math.min(Math.max(config.keep, 1), topN);
  const candidates = items.slice(0, topN);

  try {
    const hits = await rerankDocuments({
      baseUrl: config.baseUrl,
      model: config.model,
      query,
      documents: candidates.map((item) => item.documentText),
      timeoutMs: config.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    return applyRerankHits(candidates, hits, keep);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`[MemoryReranker] ${options.logLabel ?? 'rerank'} failed, keeping original order:`, message);
    return items;
  }
}

/** Sonde légère pour le bouton « Tester » des réglages. */
export async function probeMemoryReranker(input: {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const started = Date.now();
  try {
    await rerankDocuments({
      baseUrl: input.baseUrl,
      model: input.model,
      query: 'memory rerank probe',
      documents: ['alpha document about cats', 'beta document about dogs'],
      timeoutMs: input.timeoutMs ?? 800,
      fetchImpl: input.fetchImpl,
    });
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
