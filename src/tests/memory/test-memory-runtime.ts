import type { MemoryRuntimeConfig } from '../../main/config/config-schema';

export const TEST_MEMORY_RUNTIME: MemoryRuntimeConfig = {
  llm: {
    inheritFromActive: true,
    apiKey: '',
    baseUrl: '',
    model: '',
    timeoutMs: 180000,
  },
  embedding: {
    inheritFromActive: true,
    apiKey: '',
    baseUrl: '',
    model: 'text-embedding-3-small',
    timeoutMs: 180000,
  },
  useEmbedding: false,
  maxNavSteps: 2,
  ingestionConcurrency: 2,
  chunkTopK: 10,
  sessionTopK: 5,
  injectionPolicy: 'escape',
  showInjectedMemoryInChat: true,
  memoryReranker: {
    enabled: false,
    baseUrl: '',
    model: '',
    topN: 20,
    keep: 8,
    timeoutMs: 800,
  },
  storageRoot: '',
  evalEnabled: false,
  evalWorkspaces: [],
  evalMaxRounds: 12,
  evalArtifactsRoot: '',
  promptIterationRounds: 2,
};
