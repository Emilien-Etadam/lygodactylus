import { cosineSimilarity, lexicalScore, normalizeWorkspaceKey } from './memory-utils';

/** Constantes internes du ranker (pas d'UI pour l'instant). */
export const MEMORY_RANKER_CONFIG = {
  /** Demi-vie de la décroissance de fraîcheur (jours). */
  freshnessHalfLifeDays: 30,
  /** Plancher du facteur de fraîcheur (souvenir ancien mais pertinent). */
  freshnessFloor: 0.35,
} as const;

export function memoryWorkspaceBoost(
  currentWorkspace: string | null,
  sourceWorkspace?: string | null
): number {
  if (!currentWorkspace) {
    return sourceWorkspace ? 0 : -0.03;
  }
  if (sourceWorkspace === currentWorkspace) {
    return 0.3;
  }
  if (!sourceWorkspace) {
    return -0.04;
  }
  return 0;
}

export function memoryRecencyBoost(ingestedAt: string, now = Date.now()): number {
  const timestamp = Date.parse(ingestedAt);
  if (!Number.isFinite(timestamp)) {
    return 0;
  }
  const ageDays = Math.max(0, (now - timestamp) / 86_400_000);
  if (ageDays <= 3) {
    return 0.08;
  }
  if (ageDays <= 14) {
    return 0.04;
  }
  if (ageDays <= 45) {
    return 0.02;
  }
  return 0;
}

/**
 * Facteur multiplicatif de fraîcheur : décroissance exponentielle avec plancher.
 * Sans timestamp valide → 1.0 (neutre, rétro-compatibilité).
 */
export function memoryFreshnessFactor(
  timestamp: string | undefined,
  now = Date.now(),
  config: Pick<
    typeof MEMORY_RANKER_CONFIG,
    'freshnessHalfLifeDays' | 'freshnessFloor'
  > = MEMORY_RANKER_CONFIG
): number {
  if (!timestamp) {
    return 1;
  }
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  const ageDays = Math.max(0, (now - parsed) / 86_400_000);
  const halfLife = config.freshnessHalfLifeDays;
  if (!(halfLife > 0)) {
    return 1;
  }
  const decay = Math.pow(0.5, ageDays / halfLife);
  return Math.max(config.freshnessFloor, decay);
}

/** Confiance bornée à [0, 1] ; absente / invalide → 1.0 (neutre). */
export function memoryConfidenceFactor(confidence?: number): number {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    return 1;
  }
  if (confidence <= 0) {
    return 0;
  }
  if (confidence >= 1) {
    return 1;
  }
  return confidence;
}

export interface MemoryRankInput {
  query: string;
  text: string;
  queryEmbedding?: number[];
  recordEmbedding?: number[];
  currentWorkspace?: string | null;
  sourceWorkspace?: string | null;
  /** Horodatage d'ingestion (boost additif historique). */
  ingestedAt?: string;
  /** Horodatage de création de l'entrée ; prioritaire pour la fraîcheur. */
  createdAt?: string;
  /** Confiance optionnelle [0, 1] ; défaut neutre 1.0. */
  confidence?: number;
  /** Horloge injectable pour les tests de fraîcheur. */
  now?: number;
}

export function computeMemoryRankScore(input: MemoryRankInput): {
  score: number;
  evidenceScore: number;
  /** Score avant fraîcheur/confiance — base pour le pool de rerank. */
  baseScore: number;
  freshnessFactor: number;
  confidenceFactor: number;
} {
  const lexical = lexicalScore(input.query, input.text);
  const embedding =
    input.queryEmbedding?.length && input.recordEmbedding?.length
      ? cosineSimilarity(input.queryEmbedding, input.recordEmbedding)
      : 0;
  const evidenceScore = lexical + embedding;
  const currentWorkspace = normalizeWorkspaceKey(input.currentWorkspace || null);
  const now = input.now ?? Date.now();
  const baseScore =
    evidenceScore +
    memoryWorkspaceBoost(currentWorkspace, input.sourceWorkspace) +
    (input.ingestedAt ? memoryRecencyBoost(input.ingestedAt, now) : 0);
  const freshnessTimestamp = input.createdAt || input.ingestedAt;
  const freshnessFactor = memoryFreshnessFactor(freshnessTimestamp, now);
  const confidenceFactor = memoryConfidenceFactor(input.confidence);
  const score = baseScore * freshnessFactor * confidenceFactor;
  return { score, evidenceScore, baseScore, freshnessFactor, confidenceFactor };
}
