/**
 * @module main/config/config-schema
 *
 * Application configuration types, constants, defaults, and schema helpers.
 */
import { mt, DEFAULT_BACKEND_LANGUAGE } from '../i18n';

import { defaultProtocolForSharedProvider } from '../../shared/api-model-presets';
import {
  DEFAULT_OLLAMA_KEEP_ALIVE,
  normalizeOllamaKeepAlive,
} from '../../shared/ollama-keep-alive';
import {
  DEFAULT_QUICK_ASK_SELECTION_SHORTCUT,
  DEFAULT_QUICK_ASK_SHORTCUT,
  normalizeQuickAskShortcut,
} from '../../shared/quick-ask';
import {
  DEFAULT_PII_SCRUB_CONFIG,
  normalizePiiScrubConfig,
  type PiiScrubConfig,
} from '../../shared/pii-scrub';
import {
  DEFAULT_WEB_SEARCH_CONFIG,
  normalizeWebSearchConfig,
  type WebSearchConfig,
} from '../../shared/web-search';

export { DEFAULT_OLLAMA_KEEP_ALIVE, normalizeOllamaKeepAlive };
export {
  DEFAULT_QUICK_ASK_SELECTION_SHORTCUT,
  DEFAULT_QUICK_ASK_SHORTCUT,
  normalizeQuickAskShortcut,
};

export type ConstrainedOutputMode = 'auto' | 'off';

export type ConstrainedOutputField = 'ollama_format' | 'openai_json_schema';

export interface ConstrainedOutputCapabilityCache {
  baseUrl: string;
  model: string;
  supported: boolean;
  field: ConstrainedOutputField | null;
  probedAt: string;
}

export type ProviderType = 'openai' | 'anthropic';
export type CustomProtocolType = 'anthropic' | 'openai';
export const THINKING_LEVELS = ['low', 'medium', 'high'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type AppTheme = 'dark' | 'light' | 'system';
export type ProviderProfileKey = 'openai' | 'anthropic';
export type ConfigSetId = string;
export type CreateSetMode = 'blank' | 'clone';

export interface CreateConfigSetPayload {
  name: string;
  mode?: CreateSetMode;
  fromSetId?: string;
}

export interface ProviderProfile {
  apiKey: string;
  baseUrl?: string;
  model: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ApiConfigSet {
  id: ConfigSetId;
  name: string;
  isSystem?: boolean;
  provider: ProviderType;
  customProtocol: CustomProtocolType;
  activeProfileKey: ProviderProfileKey;
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>>;
  enableThinking: boolean;
  updatedAt: string;
}

export interface AppConfig {
  provider: ProviderType;
  apiKey: string;
  baseUrl?: string;
  customProtocol?: CustomProtocolType;
  model: string;
  contextWindow?: number;
  maxTokens?: number;
  activeProfileKey: ProviderProfileKey;
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>>;
  activeConfigSetId: ConfigSetId;
  configSets: ApiConfigSet[];
  claudeCodePath?: string;
  agentCliPath?: string;
  defaultWorkdir?: string;
  globalSkillsPath?: string;
  enableDevLogs: boolean;
  theme: AppTheme;
  uiLanguage?: string;
  sandboxEnabled: boolean;
  sandboxLanNetworkEnabled: boolean;
  /**
   * Reuse a per-workspace baseline copy inside the sandbox VM to seed new
   * sessions with a fast VM-local clone instead of a full cross-boundary sync.
   * Falls back to the direct per-session sync on any failure.
   */
  sandboxBaselineCacheEnabled: boolean;
  /**
   * Keep the sandbox VM (WSL2) warm with a low-frequency heartbeat while the app
   * runs, so the first command — or a scheduled task firing later — does not pay
   * a cold-VM start. Trades a little idle RAM for no cold-start latency.
   */
  sandboxKeepWarmEnabled: boolean;
  memoryEnabled: boolean;
  memoryRuntime: MemoryRuntimeConfig;
  webSearch: WebSearchConfig;
  /**
   * Opt-in PII scrubbing on outbound tool egress (web_search / web_fetch /
   * http_request / MCP). Off by default; fail-closed when enabled.
   */
  piiScrub: PiiScrubConfig;
  enableThinking: boolean;
  thinkingLevel: ThinkingLevel;
  /** Offline speechSynthesis for assistant replies (Chromium voices). Off by default. */
  speechSynthesisEnabled: boolean;
  /** Offline local STT (whisper.cpp) dictation into the composer. Off by default. */
  speechToTextEnabled: boolean;
  /** ggml model size for local STT. */
  speechToTextModel: 'base' | 'small';
  /** Whisper language mode: detect (`auto`) or follow UI locale (`ui`). */
  speechToTextLanguage: 'auto' | 'ui';
  /**
   * Show model stats (tok/s, context %, params/quant) in the chat UI.
   * On by default; opt-out in Settings.
   */
  modelStatsEnabled: boolean;
  /**
   * Capture pre-images before agent file mutations so the user can undo a run
   * without depending on git. On by default; opt-out in Settings.
   */
  checkpointsEnabled: boolean;
  /**
   * Per-workspace lint/test commands for autonomous mode (empty by default).
   * Keyed by normalized workspace absolute path.
   */
  workspaceTooling: Record<string, { lintCmd?: string; testCmd?: string }>;
  /**
   * Global Quick Ask floating window (Phase 1). Off by default — opt-in in Settings.
   */
  quickAskEnabled: boolean;
  /** Electron Accelerator for the Quick Ask global shortcut. */
  quickAskShortcut: string;
  /** Electron Accelerator for Quick Ask Sélection (clipboard text). */
  quickAskSelectionShortcut: string;
  /**
   * Ollama keep_alive duration (e.g. "30m", "1h", "-1").
   * Only sent when the active endpoint is detected as Ollama.
   */
  ollamaKeepAlive: string;
  /**
   * When 'auto', use server-side JSON-schema constrained decoding for internal
   * JSON one-shots if the endpoint was probed as capable. 'off' disables it.
   */
  constrainedOutput: ConstrainedOutputMode;
  /** Cached probe result for the active endpoint+model (invalidated on URL/model change). */
  constrainedOutputCapability: ConstrainedOutputCapabilityCache | null;
  isConfigured: boolean;
}

export type { WebSearchConfig, PiiScrubConfig };
export {
  DEFAULT_WEB_SEARCH_CONFIG,
  normalizeWebSearchConfig,
  DEFAULT_PII_SCRUB_CONFIG,
  normalizePiiScrubConfig,
};

export interface MemoryModelRuntimeConfig {
  inheritFromActive: boolean;
  provider?: ProviderType;
  customProtocol?: CustomProtocolType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs: number;
}

export type MemoryInjectionPolicy = 'escape' | 'strip-suspicious' | 'block';

/** Rerank local opt-in (POST /v1/rerank). Désactivé par défaut. */
export interface MemoryRerankerConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  /** Taille du pool candidaté avant rerank. */
  topN: number;
  /** Nombre de résultats conservés après rerank. */
  keep: number;
  timeoutMs: number;
}

export interface MemoryRuntimeConfig {
  llm: MemoryModelRuntimeConfig;
  embedding: MemoryModelRuntimeConfig;
  useEmbedding: boolean;
  /**
   * Opt-in native `semantic_search` tool (workspace file embeddings).
   * OFF by default; only exposed when embeddings endpoint is usable.
   */
  semanticSearchEnabled: boolean;
  maxNavSteps: number;
  ingestionConcurrency: number;
  chunkTopK: number;
  sessionTopK: number;
  injectionPolicy: MemoryInjectionPolicy;
  showInjectedMemoryInChat: boolean;
  /** Rerank local optionnel ; OFF par défaut, fallback silencieux. */
  memoryReranker: MemoryRerankerConfig;
  storageRoot?: string;
  evalEnabled?: boolean;
  evalWorkspaces?: string[];
  evalMaxRounds?: number;
  evalArtifactsRoot?: string;
  promptIterationRounds?: number;
}

export const DEFAULT_CONFIG_SET_ID = 'default';
export const MAX_CONFIG_SET_COUNT = 20;
export const LOCAL_ANTHROPIC_PLACEHOLDER_KEY = 'sk-ant-local-proxy';

export const DIRECT_READ_KEYS = new Set<keyof AppConfig>([
  'provider',
  'apiKey',
  'baseUrl',
  'customProtocol',
  'activeProfileKey',
  'activeConfigSetId',
  'claudeCodePath',
  'agentCliPath',
  'defaultWorkdir',
  'globalSkillsPath',
  'enableDevLogs',
  'theme',
  'sandboxEnabled',
  'sandboxLanNetworkEnabled',
  'sandboxBaselineCacheEnabled',
  'sandboxKeepWarmEnabled',
  'memoryEnabled',
  'webSearch',
  'piiScrub',
  'enableThinking',
  'thinkingLevel',
  'speechSynthesisEnabled',
  'speechToTextEnabled',
  'speechToTextModel',
  'speechToTextLanguage',
  'modelStatsEnabled',
  'checkpointsEnabled',
  'quickAskEnabled',
  'quickAskShortcut',
  'quickAskSelectionShortcut',
  'ollamaKeepAlive',
  'constrainedOutput',
  'constrainedOutputCapability',
  'isConfigured',
]);

export const PROFILE_KEYS: ProviderProfileKey[] = ['openai', 'anthropic'];

const VALID_THEMES: AppTheme[] = ['dark', 'light', 'system'];

export const defaultProfiles: Record<ProviderProfileKey, ProviderProfile> = {
  openai: {
    apiKey: '',
    baseUrl: '',
    model: '',
  },
  anthropic: {
    apiKey: '',
    baseUrl: '',
    model: '',
  },
};

export const defaultConfigSet: ApiConfigSet = {
  id: DEFAULT_CONFIG_SET_ID,
  name: mt('configDefaultSetName'),
  isSystem: true,
  provider: 'openai',
  customProtocol: 'openai',
  activeProfileKey: 'openai',
  profiles: defaultProfiles,
  enableThinking: false,
  updatedAt: '1970-01-01T00:00:00.000Z',
};

export function getDefaultSandboxEnabled(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin';
}

export function configHasStoredCredentials(config: Partial<AppConfig>): boolean {
  if (config.isConfigured) {
    return true;
  }
  const profiles = config.profiles || {};
  return Object.values(profiles).some(
    (profile) => typeof profile?.apiKey === 'string' && profile.apiKey.trim().length > 0
  );
}

export function shouldRecoverWipedConfig(current: AppConfig, recovered: AppConfig): boolean {
  if (!configHasStoredCredentials(recovered)) {
    return false;
  }
  return !configHasStoredCredentials(current);
}

export const defaultConfig: AppConfig = {
  provider: defaultConfigSet.provider,
  apiKey: defaultProfiles.openai.apiKey,
  baseUrl: defaultProfiles.openai.baseUrl,
  customProtocol: defaultConfigSet.customProtocol,
  model: defaultProfiles.openai.model,
  activeProfileKey: defaultConfigSet.activeProfileKey,
  profiles: defaultProfiles,
  activeConfigSetId: DEFAULT_CONFIG_SET_ID,
  configSets: [defaultConfigSet],
  claudeCodePath: '',
  agentCliPath: '',
  defaultWorkdir: '',
  globalSkillsPath: '',
  enableDevLogs: false,
  theme: 'light',
  uiLanguage: DEFAULT_BACKEND_LANGUAGE,
  sandboxEnabled: getDefaultSandboxEnabled(),
  sandboxLanNetworkEnabled: false,
  sandboxBaselineCacheEnabled: true,
  sandboxKeepWarmEnabled: true,
  memoryEnabled: true,
  memoryRuntime: {
    llm: {
      inheritFromActive: true,
      provider: undefined,
      customProtocol: undefined,
      apiKey: '',
      baseUrl: '',
      model: '',
      timeoutMs: 180000,
    },
    embedding: {
      inheritFromActive: true,
      provider: undefined,
      customProtocol: undefined,
      apiKey: '',
      baseUrl: '',
      model: 'text-embedding-3-small',
      timeoutMs: 180000,
    },
    useEmbedding: false,
    semanticSearchEnabled: false,
    maxNavSteps: 2,
    ingestionConcurrency: 4,
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
  },
  webSearch: { ...DEFAULT_WEB_SEARCH_CONFIG },
  piiScrub: { ...DEFAULT_PII_SCRUB_CONFIG, customTerms: [] },
  enableThinking: false,
  thinkingLevel: 'medium',
  speechSynthesisEnabled: false,
  speechToTextEnabled: false,
  speechToTextModel: 'base',
  speechToTextLanguage: 'ui',
  modelStatsEnabled: true,
  checkpointsEnabled: true,
  workspaceTooling: {},
  quickAskEnabled: false,
  quickAskShortcut: DEFAULT_QUICK_ASK_SHORTCUT,
  quickAskSelectionShortcut: DEFAULT_QUICK_ASK_SELECTION_SHORTCUT,
  ollamaKeepAlive: DEFAULT_OLLAMA_KEEP_ALIVE,
  constrainedOutput: 'auto',
  constrainedOutputCapability: null,
  isConfigured: false,
};

export function isProviderType(value: unknown): value is ProviderType {
  return value === 'openai' || value === 'anthropic';
}

export function isCustomProtocol(value: unknown): value is CustomProtocolType {
  return value === 'anthropic' || value === 'openai';
}

export function isProfileKey(value: unknown): value is ProviderProfileKey {
  return typeof value === 'string' && PROFILE_KEYS.includes(value as ProviderProfileKey);
}

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === 'string' && VALID_THEMES.includes(value as AppTheme);
}

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && THINKING_LEVELS.includes(value as ThinkingLevel);
}

export function normalizeWorkspaceTooling(
  value: unknown
): Record<string, { lintCmd?: string; testCmd?: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, { lintCmd?: string; testCmd?: string }> = {};
  for (const [rawKey, rawEntry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rawKey !== 'string' || !rawKey.trim()) {
      continue;
    }
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      continue;
    }
    const entry = rawEntry as Record<string, unknown>;
    const lintCmd =
      typeof entry.lintCmd === 'string' && entry.lintCmd.trim()
        ? entry.lintCmd.trim()
        : undefined;
    const testCmd =
      typeof entry.testCmd === 'string' && entry.testCmd.trim()
        ? entry.testCmd.trim()
        : undefined;
    if (!lintCmd && !testCmd) {
      continue;
    }
    out[rawKey.trim()] = { lintCmd, testCmd };
  }
  return out;
}

function isMemoryModelRuntimeConfig(value: unknown): value is Partial<MemoryModelRuntimeConfig> {
  return typeof value === 'object' && value !== null;
}

function normalizeMemoryModelRuntimeConfig(
  raw: unknown,
  fallback: MemoryModelRuntimeConfig
): MemoryModelRuntimeConfig {
  const value = isMemoryModelRuntimeConfig(raw) ? raw : {};
  return {
    inheritFromActive: toBoolean(value.inheritFromActive, fallback.inheritFromActive),
    provider: isProviderType(value.provider) ? value.provider : fallback.provider,
    customProtocol: isCustomProtocol(value.customProtocol)
      ? value.customProtocol
      : fallback.customProtocol,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : fallback.apiKey,
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : fallback.baseUrl,
    model: typeof value.model === 'string' ? value.model : fallback.model,
    timeoutMs:
      typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)
        ? Math.max(5000, Math.round(value.timeoutMs))
        : fallback.timeoutMs,
  };
}

function normalizeMemoryRerankerConfig(raw: unknown): MemoryRerankerConfig {
  const fallback = defaultConfig.memoryRuntime.memoryReranker;
  const value =
    typeof raw === 'object' && raw !== null ? (raw as Partial<MemoryRerankerConfig>) : {};
  const topN =
    typeof value.topN === 'number' && Number.isFinite(value.topN)
      ? Math.max(1, Math.min(50, Math.round(value.topN)))
      : fallback.topN;
  const keep =
    typeof value.keep === 'number' && Number.isFinite(value.keep)
      ? Math.max(1, Math.min(topN, Math.round(value.keep)))
      : Math.min(fallback.keep, topN);
  return {
    enabled: toBoolean(value.enabled, fallback.enabled),
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl.trim() : fallback.baseUrl,
    model: typeof value.model === 'string' ? value.model.trim() : fallback.model,
    topN,
    keep,
    timeoutMs:
      typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)
        ? Math.max(100, Math.min(30_000, Math.round(value.timeoutMs)))
        : fallback.timeoutMs,
  };
}

export function normalizeMemoryRuntimeConfig(raw: unknown): MemoryRuntimeConfig {
  const value =
    typeof raw === 'object' && raw !== null ? (raw as Partial<MemoryRuntimeConfig>) : {};
  return {
    llm: normalizeMemoryModelRuntimeConfig(value.llm, defaultConfig.memoryRuntime.llm),
    embedding: normalizeMemoryModelRuntimeConfig(
      value.embedding,
      defaultConfig.memoryRuntime.embedding
    ),
    useEmbedding: toBoolean(value.useEmbedding, defaultConfig.memoryRuntime.useEmbedding),
    semanticSearchEnabled: toBoolean(
      value.semanticSearchEnabled,
      defaultConfig.memoryRuntime.semanticSearchEnabled
    ),
    maxNavSteps:
      typeof value.maxNavSteps === 'number' && Number.isFinite(value.maxNavSteps)
        ? Math.max(0, Math.min(4, Math.round(value.maxNavSteps)))
        : defaultConfig.memoryRuntime.maxNavSteps,
    ingestionConcurrency:
      typeof value.ingestionConcurrency === 'number' && Number.isFinite(value.ingestionConcurrency)
        ? Math.max(1, Math.min(16, Math.round(value.ingestionConcurrency)))
        : defaultConfig.memoryRuntime.ingestionConcurrency,
    chunkTopK:
      typeof value.chunkTopK === 'number' && Number.isFinite(value.chunkTopK)
        ? Math.max(1, Math.min(30, Math.round(value.chunkTopK)))
        : defaultConfig.memoryRuntime.chunkTopK,
    sessionTopK:
      typeof value.sessionTopK === 'number' && Number.isFinite(value.sessionTopK)
        ? Math.max(1, Math.min(20, Math.round(value.sessionTopK)))
        : defaultConfig.memoryRuntime.sessionTopK,
    injectionPolicy:
      value.injectionPolicy === 'strip-suspicious' || value.injectionPolicy === 'block'
        ? value.injectionPolicy
        : defaultConfig.memoryRuntime.injectionPolicy,
    showInjectedMemoryInChat: toBoolean(
      value.showInjectedMemoryInChat,
      defaultConfig.memoryRuntime.showInjectedMemoryInChat
    ),
    memoryReranker: normalizeMemoryRerankerConfig(value.memoryReranker),
    storageRoot:
      typeof value.storageRoot === 'string'
        ? value.storageRoot
        : defaultConfig.memoryRuntime.storageRoot,
    evalEnabled: toBoolean(value.evalEnabled, defaultConfig.memoryRuntime.evalEnabled ?? false),
    evalWorkspaces: Array.isArray(value.evalWorkspaces)
      ? value.evalWorkspaces.filter((item): item is string => typeof item === 'string')
      : defaultConfig.memoryRuntime.evalWorkspaces,
    evalMaxRounds:
      typeof value.evalMaxRounds === 'number' && Number.isFinite(value.evalMaxRounds)
        ? Math.max(1, Math.min(100, Math.round(value.evalMaxRounds)))
        : defaultConfig.memoryRuntime.evalMaxRounds,
    evalArtifactsRoot:
      typeof value.evalArtifactsRoot === 'string'
        ? value.evalArtifactsRoot
        : defaultConfig.memoryRuntime.evalArtifactsRoot,
    promptIterationRounds:
      typeof value.promptIterationRounds === 'number' &&
      Number.isFinite(value.promptIterationRounds)
        ? Math.max(0, Math.min(10, Math.round(value.promptIterationRounds)))
        : defaultConfig.memoryRuntime.promptIterationRounds,
  };
}

export function profileKeyFromProvider(
  provider: ProviderType,
  _customProtocol: CustomProtocolType = 'anthropic'
): ProviderProfileKey {
  return provider;
}

export function profileKeyToProvider(profileKey: ProviderProfileKey): {
  provider: ProviderType;
  customProtocol: CustomProtocolType;
} {
  return {
    provider: profileKey,
    customProtocol: defaultProtocolForProvider(profileKey),
  };
}

export function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function normalizeCustomProtocol(
  value: CustomProtocolType | undefined,
  fallback: CustomProtocolType = 'anthropic'
): CustomProtocolType {
  if (value === 'openai' || value === 'anthropic') {
    return value;
  }
  return fallback;
}

export function defaultProtocolForProvider(provider: ProviderType): CustomProtocolType {
  return defaultProtocolForSharedProvider(provider);
}
