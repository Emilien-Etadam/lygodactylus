/**
 * @module main/config/config-normalizer
 *
 * Normalization logic for persisted application configuration.
 */
import { mt } from '../i18n';
import { normalizeOllamaBaseUrl } from './auth-utils';
import { migrateLegacyConfig } from './provider-migration';
import {
  DEFAULT_CONFIG_SET_ID,
  PROFILE_KEYS,
  defaultConfig,
  defaultConfigSet,
  defaultProfiles,
  defaultProtocolForProvider,
  isCustomProtocol,
  isProfileKey,
  isProviderType,
  isAppTheme,
  isThinkingLevel,
  normalizeMemoryRuntimeConfig,
  normalizeOllamaKeepAlive,
  normalizeQuickAskShortcut,
  normalizePiiScrubConfig,
  normalizeWebSearchConfig,
  normalizeWorkspaceTooling,
  nowISO,
  DEFAULT_QUICK_ASK_SELECTION_SHORTCUT,
  DEFAULT_QUICK_ASK_SHORTCUT,
  profileKeyFromProvider,
  toBoolean,
  toNonEmptyString,
  type ApiConfigSet,
  type AppConfig,
  type AppTheme,
  type ConfigSetId,
  type CreateSetMode,
  type CustomProtocolType,
  type ProviderProfile,
  type ProviderProfileKey,
  type ProviderType,
} from './config-schema';
import {
  normalizeConstrainedOutputCapability,
  normalizeConstrainedOutputMode,
} from './endpoint-capabilities';

function getDefaultProfile(profileKey: ProviderProfileKey): ProviderProfile {
  const fallback = defaultProfiles[profileKey];
  return {
    apiKey: fallback.apiKey,
    baseUrl: fallback.baseUrl,
    model: fallback.model,
  };
}

export function normalizeProfile(
  profileKey: ProviderProfileKey,
  profile: Partial<ProviderProfile> | undefined
): ProviderProfile {
  const fallback = getDefaultProfile(profileKey);
  const model =
    typeof profile?.model === 'string' && profile.model.trim()
      ? profile.model.trim()
      : fallback.model;
  const rawBaseUrl =
    typeof profile?.baseUrl === 'string' && profile.baseUrl.trim()
      ? profile.baseUrl.trim()
      : fallback.baseUrl;
  const baseUrl =
    profileKey === 'openai' && rawBaseUrl
      ? normalizeOllamaBaseUrl(rawBaseUrl) || rawBaseUrl
      : rawBaseUrl;
  const result: ProviderProfile = {
    apiKey: typeof profile?.apiKey === 'string' ? profile.apiKey : '',
    baseUrl,
    model,
  };
  if (typeof profile?.contextWindow === 'number' && profile.contextWindow > 0) {
    result.contextWindow = profile.contextWindow;
  }
  if (typeof profile?.maxTokens === 'number' && profile.maxTokens > 0) {
    result.maxTokens = profile.maxTokens;
  }
  return result;
}

export function cloneProfiles(
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>> | undefined
): Record<ProviderProfileKey, ProviderProfile> {
  const cloned = {} as Record<ProviderProfileKey, ProviderProfile>;
  for (const key of PROFILE_KEYS) {
    cloned[key] = normalizeProfile(key, profiles?.[key]);
  }
  return cloned;
}

/**
 * Auto-fix model IDs that don't match pi-ai registry format.
 * Non-destructive: only applies known safe transformations at read time.
 */
export function normalizeModelIds(_config: AppConfig): void {
  // Legacy model ID normalization removed — only local/compatible providers remain.
}

export function projectFromConfigSet(configSet: ApiConfigSet): {
  provider: ProviderType;
  customProtocol: CustomProtocolType;
  activeProfileKey: ProviderProfileKey;
  profiles: Record<ProviderProfileKey, ProviderProfile>;
  apiKey: string;
  baseUrl?: string;
  model: string;
  contextWindow?: number;
  maxTokens?: number;
  enableThinking: boolean;
} {
  const profiles = cloneProfiles(configSet.profiles);
  const activeProfileKey = isProfileKey(configSet.activeProfileKey)
    ? configSet.activeProfileKey
    : profileKeyFromProvider(configSet.provider, configSet.customProtocol);
  const activeProfile = profiles[activeProfileKey] || getDefaultProfile(activeProfileKey);

  return {
    provider: configSet.provider,
    customProtocol: configSet.customProtocol,
    activeProfileKey,
    profiles,
    apiKey: activeProfile.apiKey,
    baseUrl: activeProfile.baseUrl,
    model: activeProfile.model,
    contextWindow: activeProfile.contextWindow,
    maxTokens: activeProfile.maxTokens,
    enableThinking: toBoolean(configSet.enableThinking, false),
  };
}

export function normalizeConfigSet(
  rawSet: Partial<ApiConfigSet> | undefined,
  fallback: {
    id: string;
    name: string;
    provider: ProviderType;
    customProtocol: CustomProtocolType;
    activeProfileKey: ProviderProfileKey;
    profiles: Record<ProviderProfileKey, ProviderProfile>;
    enableThinking: boolean;
    isSystem?: boolean;
  }
): ApiConfigSet {
  const provider = isProviderType(rawSet?.provider) ? rawSet.provider : fallback.provider;
  const customProtocol: CustomProtocolType = isCustomProtocol(rawSet?.customProtocol)
    ? rawSet.customProtocol
    : defaultProtocolForProvider(provider);

  const derivedProfileKey = profileKeyFromProvider(provider, customProtocol);
  const activeProfileKey = isProfileKey(rawSet?.activeProfileKey)
    ? rawSet.activeProfileKey
    : fallback.activeProfileKey || derivedProfileKey;

  const profiles = cloneProfiles(rawSet?.profiles || fallback.profiles);

  if (!profiles[activeProfileKey]) {
    profiles[activeProfileKey] = getDefaultProfile(activeProfileKey);
  }

  const id = toNonEmptyString(rawSet?.id) || fallback.id;
  const name = toNonEmptyString(rawSet?.name) || fallback.name;
  const updatedAt = toNonEmptyString(rawSet?.updatedAt) || nowISO();

  return {
    id,
    name,
    isSystem: toBoolean(rawSet?.isSystem, Boolean(fallback.isSystem)),
    provider,
    customProtocol,
    activeProfileKey,
    profiles,
    enableThinking: toBoolean(rawSet?.enableThinking, fallback.enableThinking),
    updatedAt,
  };
}

function makeDefaultConfigSetFromLegacy(legacy: {
  provider: ProviderType;
  customProtocol: CustomProtocolType;
  activeProfileKey: ProviderProfileKey;
  profiles: Record<ProviderProfileKey, ProviderProfile>;
  enableThinking: boolean;
}): ApiConfigSet {
  return normalizeConfigSet(
    {
      id: DEFAULT_CONFIG_SET_ID,
      name: defaultConfigSet.name,
      isSystem: true,
      provider: legacy.provider,
      customProtocol: legacy.customProtocol,
      activeProfileKey: legacy.activeProfileKey,
      profiles: legacy.profiles,
      enableThinking: legacy.enableThinking,
      updatedAt: nowISO(),
    },
    {
      id: DEFAULT_CONFIG_SET_ID,
      name: defaultConfigSet.name,
      isSystem: true,
      provider: legacy.provider,
      customProtocol: legacy.customProtocol,
      activeProfileKey: legacy.activeProfileKey,
      profiles: legacy.profiles,
      enableThinking: legacy.enableThinking,
    }
  );
}

export function normalizeConfigSets(
  rawSets: unknown,
  legacy: {
    provider: ProviderType;
    customProtocol: CustomProtocolType;
    activeProfileKey: ProviderProfileKey;
    profiles: Record<ProviderProfileKey, ProviderProfile>;
    enableThinking: boolean;
  }
): ApiConfigSet[] {
  const list = Array.isArray(rawSets) ? rawSets : [];
  if (list.length === 0) {
    return [makeDefaultConfigSetFromLegacy(legacy)];
  }

  const normalized: ApiConfigSet[] = [];
  const usedIds = new Set<string>();

  for (let index = 0; index < list.length; index += 1) {
    const rawSet = (list[index] || {}) as Partial<ApiConfigSet>;
    const seedId = toNonEmptyString(rawSet.id) || `set-${index + 1}`;
    let nextId = seedId;
    let suffix = 2;
    while (usedIds.has(nextId)) {
      nextId = `${seedId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(nextId);

    const normalizedSet = normalizeConfigSet(rawSet, {
      id: nextId,
      name: toNonEmptyString(rawSet.name) || mt('configFallbackSetName', { index: index + 1 }),
      provider: legacy.provider,
      customProtocol: legacy.customProtocol,
      activeProfileKey: legacy.activeProfileKey,
      profiles: legacy.profiles,
      enableThinking: legacy.enableThinking,
      isSystem: Boolean(rawSet.isSystem),
    });
    normalizedSet.id = nextId;
    normalized.push(normalizedSet);
  }

  const hasSystemSet = normalized.some((set) => set.isSystem);
  if (!hasSystemSet) {
    normalized.unshift(makeDefaultConfigSetFromLegacy(legacy));
  }

  return normalized;
}

function configSetMatchesLegacySeed(
  configSet: ApiConfigSet,
  legacy: {
    provider: ProviderType;
    customProtocol: CustomProtocolType;
    activeProfileKey: ProviderProfileKey;
    profiles: Record<ProviderProfileKey, ProviderProfile>;
    enableThinking: boolean;
  }
): boolean {
  const projected = projectFromConfigSet(configSet);
  const legacyActive = legacy.profiles[legacy.activeProfileKey];
  return (
    projected.provider === legacy.provider &&
    projected.customProtocol === legacy.customProtocol &&
    projected.activeProfileKey === legacy.activeProfileKey &&
    projected.enableThinking === legacy.enableThinking &&
    projected.apiKey === legacyActive.apiKey &&
    (projected.baseUrl || '') === (legacyActive.baseUrl || '') &&
    projected.model === legacyActive.model
  );
}

function shouldRebuildDefaultConfigSet(
  normalizedSets: ApiConfigSet[],
  legacy: {
    provider: ProviderType;
    customProtocol: CustomProtocolType;
    activeProfileKey: ProviderProfileKey;
    profiles: Record<ProviderProfileKey, ProviderProfile>;
    enableThinking: boolean;
  }
): boolean {
  if (normalizedSets.length !== 1) {
    return false;
  }

  const onlySet = normalizedSets[0];
  if (!(onlySet.id === DEFAULT_CONFIG_SET_ID && onlySet.isSystem)) {
    return false;
  }

  return !configSetMatchesLegacySeed(onlySet, legacy);
}

export function normalizeConfig(rawConfig: Partial<AppConfig> | undefined): AppConfig {
  const raw = rawConfig || {};
  const migrated = migrateLegacyConfig(raw as Partial<AppConfig> & Record<string, unknown>);

  const provider = isProviderType(migrated.provider) ? migrated.provider : defaultConfig.provider;
  const customProtocol: CustomProtocolType = isCustomProtocol(migrated.customProtocol)
    ? migrated.customProtocol
    : defaultProtocolForProvider(provider);
  const derivedProfileKey = profileKeyFromProvider(provider, customProtocol);
  const activeProfileKey = isProfileKey(migrated.activeProfileKey)
    ? migrated.activeProfileKey
    : derivedProfileKey;
  const profiles = cloneProfiles(migrated.profiles);

  const legacySeed = {
    provider,
    customProtocol,
    activeProfileKey,
    profiles,
    enableThinking: toBoolean(migrated.enableThinking, defaultConfig.enableThinking),
  };

  const normalizedFromRaw = normalizeConfigSets(migrated.configSets, legacySeed);
  const configSets = shouldRebuildDefaultConfigSet(normalizedFromRaw, legacySeed)
    ? [makeDefaultConfigSetFromLegacy(legacySeed)]
    : normalizedFromRaw;

  const requestedActiveSetId = toNonEmptyString(migrated.activeConfigSetId);
  const activeConfigSetId = configSets.some((set) => set.id === requestedActiveSetId)
    ? (requestedActiveSetId as string)
    : configSets[0].id;

  const activeConfigSet = configSets.find((set) => set.id === activeConfigSetId) || configSets[0];
  const projected = projectFromConfigSet(activeConfigSet);

  const result: AppConfig = {
    provider: projected.provider,
    customProtocol: projected.customProtocol,
    apiKey: projected.apiKey,
    baseUrl: projected.baseUrl,
    model: projected.model,
    activeProfileKey: projected.activeProfileKey,
    profiles: projected.profiles,
    activeConfigSetId,
    configSets,
    claudeCodePath: defaultConfig.claudeCodePath,
    agentCliPath:
      typeof migrated.agentCliPath === 'string'
        ? migrated.agentCliPath
        : defaultConfig.agentCliPath,
    defaultWorkdir:
      typeof raw.defaultWorkdir === 'string' ? raw.defaultWorkdir : defaultConfig.defaultWorkdir,
    globalSkillsPath:
      typeof raw.globalSkillsPath === 'string'
        ? raw.globalSkillsPath
        : defaultConfig.globalSkillsPath,
    enableDevLogs: toBoolean(raw.enableDevLogs, defaultConfig.enableDevLogs),
    theme: isAppTheme(raw.theme) ? raw.theme : defaultConfig.theme,
    uiLanguage:
      typeof raw.uiLanguage === 'string' && raw.uiLanguage.trim()
        ? raw.uiLanguage
        : defaultConfig.uiLanguage,
    sandboxEnabled: toBoolean(raw.sandboxEnabled, defaultConfig.sandboxEnabled),
    sandboxLanNetworkEnabled: toBoolean(
      raw.sandboxLanNetworkEnabled,
      defaultConfig.sandboxLanNetworkEnabled
    ),
    sandboxBaselineCacheEnabled: toBoolean(
      raw.sandboxBaselineCacheEnabled,
      defaultConfig.sandboxBaselineCacheEnabled
    ),
    memoryEnabled: toBoolean(raw.memoryEnabled, defaultConfig.memoryEnabled),
    memoryRuntime: normalizeMemoryRuntimeConfig(raw.memoryRuntime),
    webSearch: normalizeWebSearchConfig(raw.webSearch),
    piiScrub: normalizePiiScrubConfig(raw.piiScrub),
    enableThinking: projected.enableThinking,
    thinkingLevel: isThinkingLevel(raw.thinkingLevel)
      ? raw.thinkingLevel
      : defaultConfig.thinkingLevel,
    speechSynthesisEnabled: toBoolean(
      raw.speechSynthesisEnabled,
      defaultConfig.speechSynthesisEnabled
    ),
    speechToTextEnabled: toBoolean(raw.speechToTextEnabled, defaultConfig.speechToTextEnabled),
    speechToTextModel:
      raw.speechToTextModel === 'small' || raw.speechToTextModel === 'base'
        ? raw.speechToTextModel
        : defaultConfig.speechToTextModel,
    speechToTextLanguage:
      raw.speechToTextLanguage === 'auto' || raw.speechToTextLanguage === 'ui'
        ? raw.speechToTextLanguage
        : defaultConfig.speechToTextLanguage,
    modelStatsEnabled: toBoolean(raw.modelStatsEnabled, defaultConfig.modelStatsEnabled),
    checkpointsEnabled: toBoolean(raw.checkpointsEnabled, defaultConfig.checkpointsEnabled),
    workspaceTooling: normalizeWorkspaceTooling(raw.workspaceTooling),
    quickAskEnabled: toBoolean(raw.quickAskEnabled, defaultConfig.quickAskEnabled),
    quickAskShortcut:
      normalizeQuickAskShortcut(raw.quickAskShortcut) ||
      defaultConfig.quickAskShortcut ||
      DEFAULT_QUICK_ASK_SHORTCUT,
    quickAskSelectionShortcut:
      normalizeQuickAskShortcut(raw.quickAskSelectionShortcut) ||
      defaultConfig.quickAskSelectionShortcut ||
      DEFAULT_QUICK_ASK_SELECTION_SHORTCUT,
    ollamaKeepAlive: normalizeOllamaKeepAlive(
      typeof raw.ollamaKeepAlive === 'string' || typeof raw.ollamaKeepAlive === 'number'
        ? raw.ollamaKeepAlive
        : defaultConfig.ollamaKeepAlive
    ),
    constrainedOutput: normalizeConstrainedOutputMode(raw.constrainedOutput),
    constrainedOutputCapability: normalizeConstrainedOutputCapability(
      raw.constrainedOutputCapability
    ),
    isConfigured: toBoolean(raw.isConfigured, defaultConfig.isConfigured),
  };
  normalizeModelIds(result);
  return result;
}

export function cloneConfigSet(configSet: ApiConfigSet): ApiConfigSet {
  return {
    ...configSet,
    profiles: cloneProfiles(configSet.profiles),
    updatedAt: toNonEmptyString(configSet.updatedAt) || nowISO(),
  };
}

export function composeProjectedConfig(
  base: AppConfig,
  nextConfigSets: ApiConfigSet[],
  requestedActiveConfigSetId: string
): AppConfig {
  const activeConfigSet =
    nextConfigSets.find((set) => set.id === requestedActiveConfigSetId) || nextConfigSets[0];
  const projected = projectFromConfigSet(activeConfigSet);
  return {
    ...base,
    provider: projected.provider,
    customProtocol: projected.customProtocol,
    apiKey: projected.apiKey,
    baseUrl: projected.baseUrl,
    model: projected.model,
    activeProfileKey: projected.activeProfileKey,
    profiles: projected.profiles,
    enableThinking: projected.enableThinking,
    activeConfigSetId: activeConfigSet.id,
    configSets: nextConfigSets,
  };
}

export function buildUniqueConfigSetName(
  name: string,
  existingSets: ApiConfigSet[],
  excludeId?: string
): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Config set name is required');
  }

  const usedNames = new Set(
    existingSets.filter((set) => set.id !== excludeId).map((set) => set.name)
  );

  if (!usedNames.has(trimmed)) {
    return trimmed;
  }

  let suffix = 2;
  let candidate = `${trimmed} (${suffix})`;
  while (usedNames.has(candidate) && suffix <= 100) {
    suffix += 1;
    candidate = `${trimmed} (${suffix})`;
  }
  return candidate;
}

export function generateConfigSetId(existingSets: ApiConfigSet[]): ConfigSetId {
  let index = existingSets.length + 1;
  let candidate = `set-${index}`;
  const used = new Set(existingSets.map((set) => set.id));
  while (used.has(candidate)) {
    index += 1;
    candidate = `set-${index}`;
  }
  return candidate;
}

export function buildBlankConfigSet(payload: {
  id: ConfigSetId;
  name: string;
  provider: ProviderType;
  customProtocol: CustomProtocolType;
}): ApiConfigSet {
  const activeProfileKey = profileKeyFromProvider(payload.provider, payload.customProtocol);
  const profiles = cloneProfiles(undefined);
  const defaultProfile = getDefaultProfile(activeProfileKey);
  profiles[activeProfileKey] = normalizeProfile(activeProfileKey, {
    apiKey: '',
    baseUrl: defaultProfile.baseUrl,
    model: defaultProfile.model,
  });

  return {
    id: payload.id,
    name: payload.name,
    isSystem: false,
    provider: payload.provider,
    customProtocol: payload.customProtocol,
    activeProfileKey,
    profiles,
    enableThinking: false,
    updatedAt: nowISO(),
  };
}

export type { AppTheme, CreateSetMode };
