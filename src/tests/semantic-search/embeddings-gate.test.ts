import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../main/config/config-schema';
import { defaultConfig } from '../../main/config/config-schema';
import {
  isMemoryEmbeddingEndpointUsable,
  isSemanticSearchToolEnabled,
} from '../../main/semantic-search/embeddings-gate';

function baseConfig(
  overrides: {
    baseUrl?: string;
    semanticSearchEnabled?: boolean;
    useEmbedding?: boolean;
    embeddingBaseUrl?: string;
    inheritFromActive?: boolean;
    embeddingProvider?: 'openai' | 'anthropic';
  } = {}
): AppConfig {
  return {
    ...defaultConfig,
    provider: 'openai',
    apiKey: 'sk-test',
    baseUrl: overrides.baseUrl ?? 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    memoryRuntime: {
      ...defaultConfig.memoryRuntime,
      useEmbedding: overrides.useEmbedding ?? true,
      semanticSearchEnabled: overrides.semanticSearchEnabled ?? true,
      embedding: {
        ...defaultConfig.memoryRuntime.embedding,
        inheritFromActive: overrides.inheritFromActive ?? true,
        provider: overrides.embeddingProvider,
        baseUrl: overrides.embeddingBaseUrl ?? '',
        model: 'text-embedding-3-small',
        apiKey: 'sk-local',
      },
    },
  };
}

describe('semantic search embeddings gate', () => {
  it('requires semanticSearchEnabled + useEmbedding + usable endpoint', () => {
    expect(isSemanticSearchToolEnabled(baseConfig())).toBe(true);
    expect(isSemanticSearchToolEnabled(baseConfig({ semanticSearchEnabled: false }))).toBe(false);
    expect(isSemanticSearchToolEnabled(baseConfig({ useEmbedding: false }))).toBe(false);
  });

  it('skips inherited non-OpenAI inference endpoints (same as MemoryLLMClient)', () => {
    const config = baseConfig({
      baseUrl: 'http://127.0.0.1:11434/v1',
      inheritFromActive: true,
      embeddingBaseUrl: '',
    });
    expect(isMemoryEmbeddingEndpointUsable(config)).toBe(false);
    expect(isSemanticSearchToolEnabled(config)).toBe(false);
  });

  it('allows an explicit non-vLLM OpenAI-compatible embedding baseUrl', () => {
    const config = baseConfig({
      baseUrl: 'http://127.0.0.1:11434/v1',
      inheritFromActive: false,
      embeddingBaseUrl: 'http://127.0.0.1:8080/v1',
      embeddingProvider: 'openai',
    });
    expect(isMemoryEmbeddingEndpointUsable(config)).toBe(true);
    expect(isSemanticSearchToolEnabled(config)).toBe(true);
  });
});
