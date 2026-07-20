import { Type, type TSchema } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { configStore } from '../config/config-store';
import { isSemanticSearchToolEnabled } from '../semantic-search/embeddings-gate';
import { getSemanticIndexService } from '../semantic-search/index-manager';
import { SEMANTIC_DEFAULT_TOP_K, SEMANTIC_MAX_TOP_K } from '../semantic-search/constants';
import type { SemanticSearchHit } from '../semantic-search/index-service';

const semanticSearchParameters = Type.Object({
  query: Type.String({
    minLength: 1,
    description: 'Natural-language search query (semantic grep over workspace text files)',
  }),
  top_k: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: SEMANTIC_MAX_TOP_K,
      description: `Max hits to return (default ${SEMANTIC_DEFAULT_TOP_K}, max ${SEMANTIC_MAX_TOP_K})`,
    })
  ),
});

function formatHits(hits: SemanticSearchHit[]): string {
  if (hits.length === 0) {
    return 'No semantic matches found.';
  }
  return JSON.stringify(hits, null, 2);
}

function parseTopK(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(1, Math.min(SEMANTIC_MAX_TOP_K, Math.round(raw)));
  }
  return SEMANTIC_DEFAULT_TOP_K;
}

function createSemanticSearchTool(
  name: string,
  label: string,
  cwd: string
): ToolDefinition<TSchema, unknown> {
  return {
    name,
    label,
    description:
      'Semantic search over workspace text files (grep by meaning). Returns ranked file:line hits with excerpts. Complements glob/grep; not a document RAG.',
    parameters: semanticSearchParameters,
    async execute(_toolCallId, params) {
      const record =
        typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {};
      const query = typeof record.query === 'string' ? record.query : '';
      const topK = parseTopK(record.top_k);
      const hits = await getSemanticIndexService().search(cwd, query, topK);
      return {
        content: [{ type: 'text' as const, text: formatHits(hits) }],
        details: { hits },
      };
    },
  };
}

/**
 * Expose semantic_search only when the opt-in setting is on and embeddings
 * are configured (same memoryRuntime.embedding endpoint). Otherwise [].
 */
export function buildSemanticSearchCustomTools(cwd: string): ToolDefinition[] {
  const config = configStore.getAll();
  if (!isSemanticSearchToolEnabled(config)) {
    return [];
  }
  return [createSemanticSearchTool('semantic_search', 'Semantic Search', cwd)];
}
