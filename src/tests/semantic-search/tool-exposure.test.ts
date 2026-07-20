import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../main/config/config-schema';
import { defaultConfig } from '../../main/config/config-schema';

const mockState = vi.hoisted(() => ({
  // Assigned in beforeEach before any tool builder call.
  config: undefined as unknown as AppConfig,
}));

vi.mock('../../main/config/config-store', () => ({
  configStore: {
    getAll: () => mockState.config,
    get: (key: keyof AppConfig) => mockState.config[key],
  },
}));

vi.mock('../../main/semantic-search/index-manager', () => ({
  getSemanticIndexService: () => ({
    search: vi.fn(async () => []),
  }),
}));

import { buildSemanticSearchCustomTools } from '../../main/agent/agent-runner-semantic-search-tool';

function enabledConfig(): AppConfig {
  return {
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
}

describe('buildSemanticSearchCustomTools', () => {
  beforeEach(() => {
    mockState.config = enabledConfig();
  });

  it('exposes semantic_search when opt-in + embeddings are ready', () => {
    const tools = buildSemanticSearchCustomTools('/tmp/ws');
    expect(tools.map((tool) => tool.name)).toEqual(['semantic_search']);
  });

  it('hides the tool when semantic search is OFF', () => {
    mockState.config = {
      ...enabledConfig(),
      memoryRuntime: {
        ...enabledConfig().memoryRuntime,
        semanticSearchEnabled: false,
      },
    };
    expect(buildSemanticSearchCustomTools('/tmp/ws')).toEqual([]);
  });

  it('hides the tool when embeddings are not usable', () => {
    mockState.config = {
      ...enabledConfig(),
      baseUrl: 'http://127.0.0.1:8000/v1',
      memoryRuntime: {
        ...enabledConfig().memoryRuntime,
        useEmbedding: true,
        semanticSearchEnabled: true,
        embedding: {
          ...enabledConfig().memoryRuntime.embedding,
          inheritFromActive: true,
          baseUrl: '',
        },
      },
    };
    expect(buildSemanticSearchCustomTools('/tmp/ws')).toEqual([]);
  });
});
