import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../main/config/config-schema';

const mockState = vi.hoisted(() => ({
  config: null as AppConfig | null,
}));

vi.mock('../../main/config/config-store', () => ({
  configStore: {
    getAll: () => {
      if (!mockState.config) {
        throw new Error('config not initialized');
      }
      return mockState.config;
    },
    get: (key: keyof AppConfig) => {
      if (!mockState.config) {
        throw new Error('config not initialized');
      }
      return mockState.config[key];
    },
  },
}));

vi.mock('../../main/semantic-search/index-manager', () => ({
  getSemanticIndexService: () => ({
    search: vi.fn(async () => []),
  }),
}));

import { defaultConfig } from '../../main/config/config-schema';
import { buildSemanticSearchCustomTools } from '../../main/agent/agent-runner-semantic-search-tool';

describe('buildSemanticSearchCustomTools', () => {
  beforeEach(() => {
    mockState.config = {
      ...defaultConfig,
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      memoryRuntime: {
        ...defaultConfig.memoryRuntime,
        useEmbedding: true,
        semanticSearchEnabled: true,
      },
    };
  });

  it('exposes semantic_search when opt-in + embeddings are ready', () => {
    const tools = buildSemanticSearchCustomTools('/tmp/ws');
    expect(tools.map((tool) => tool.name)).toEqual(['semantic_search']);
  });

  it('hides the tool when semantic search is OFF', () => {
    mockState.config = {
      ...mockState.config,
      memoryRuntime: {
        ...mockState.config.memoryRuntime,
        semanticSearchEnabled: false,
      },
    };
    expect(buildSemanticSearchCustomTools('/tmp/ws')).toEqual([]);
  });

  it('hides the tool when embeddings are not usable', () => {
    mockState.config = {
      ...mockState.config,
      baseUrl: 'http://127.0.0.1:8000/v1',
      memoryRuntime: {
        ...mockState.config.memoryRuntime,
        useEmbedding: true,
        semanticSearchEnabled: true,
        embedding: {
          ...mockState.config.memoryRuntime.embedding,
          inheritFromActive: true,
          baseUrl: '',
        },
      },
    };
    expect(buildSemanticSearchCustomTools('/tmp/ws')).toEqual([]);
  });
});
