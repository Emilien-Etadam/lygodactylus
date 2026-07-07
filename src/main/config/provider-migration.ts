import { defaultProtocolForSharedProvider } from '../../shared/api-model-presets';
import type {
  ApiConfigSet,
  AppConfig,
  CustomProtocolType,
  ProviderProfile,
  ProviderProfileKey,
  ProviderType,
} from './config-schema';
import { isCustomProtocol, isProfileKey, isProviderType, profileKeyFromProvider } from './config-schema';

const LEGACY_PROFILE_KEYS = new Set([
  'openrouter',
  'gemini',
  'ollama',
  'vllm',
  'custom:openai',
  'custom:gemini',
]);

export function migrateLegacyProviderType(
  rawProvider: unknown,
  options?: { customProtocol?: CustomProtocolType; model?: string }
): ProviderType {
  if (isProviderType(rawProvider)) {
    return rawProvider;
  }

  if (rawProvider === 'custom:anthropic') {
    return 'anthropic';
  }

  if (rawProvider === 'openrouter') {
    const model = options?.model?.trim() || '';
    return model.startsWith('anthropic/') ? 'anthropic' : 'openai';
  }

  if (
    rawProvider === 'ollama' ||
    rawProvider === 'vllm' ||
    rawProvider === 'gemini' ||
    rawProvider === 'custom'
  ) {
    return options?.customProtocol === 'anthropic' ? 'anthropic' : 'openai';
  }

  return 'openai';
}

export function migrateLegacyProfileKey(
  rawKey: unknown,
  profile?: Partial<ProviderProfile>,
  fallbackProvider: ProviderType = 'openai'
): ProviderProfileKey {
  if (isProfileKey(rawKey)) {
    return rawKey;
  }

  if (rawKey === 'custom:anthropic') {
    return 'anthropic';
  }

  if (typeof rawKey === 'string' && LEGACY_PROFILE_KEYS.has(rawKey)) {
    if (rawKey === 'openrouter') {
      return migrateLegacyProviderType('openrouter', { model: profile?.model }) === 'anthropic'
        ? 'anthropic'
        : 'openai';
    }
    return 'openai';
  }

  return fallbackProvider;
}

function mergeLegacyProfiles(
  profiles: Record<string, Partial<ProviderProfile>> | undefined
): Partial<Record<ProviderProfileKey, ProviderProfile>> {
  const merged: Partial<Record<ProviderProfileKey, ProviderProfile>> = {};

  const assignIfEmpty = (targetKey: ProviderProfileKey, source?: Partial<ProviderProfile>) => {
    if (!source) {
      return;
    }
    const existing = merged[targetKey];
    const hasExistingData =
      Boolean(existing?.apiKey?.trim()) ||
      Boolean(existing?.model?.trim()) ||
      Boolean(existing?.baseUrl?.trim());
    if (!hasExistingData) {
      merged[targetKey] = {
        apiKey: typeof source.apiKey === 'string' ? source.apiKey : '',
        baseUrl: typeof source.baseUrl === 'string' ? source.baseUrl : undefined,
        model: typeof source.model === 'string' ? source.model : '',
        ...(typeof source.contextWindow === 'number' ? { contextWindow: source.contextWindow } : {}),
        ...(typeof source.maxTokens === 'number' ? { maxTokens: source.maxTokens } : {}),
      };
    }
  };

  for (const [rawKey, profile] of Object.entries(profiles || {})) {
    assignIfEmpty(migrateLegacyProfileKey(rawKey, profile), profile);
  }

  return merged;
}

function migrateLegacyConfigSet(rawSet: Partial<ApiConfigSet>): Partial<ApiConfigSet> {
  const migratedProfiles = mergeLegacyProfiles(
    rawSet.profiles as Record<string, Partial<ProviderProfile>> | undefined
  );
  const activeSeed = isProfileKey(rawSet.activeProfileKey)
    ? migratedProfiles[rawSet.activeProfileKey]
    : migratedProfiles[migrateLegacyProfileKey(rawSet.activeProfileKey)];
  const provider = migrateLegacyProviderType(rawSet.provider, {
    customProtocol: isCustomProtocol(rawSet.customProtocol) ? rawSet.customProtocol : undefined,
    model: activeSeed?.model,
  });
  const customProtocol = isCustomProtocol(rawSet.customProtocol)
    ? rawSet.customProtocol
    : defaultProtocolForSharedProvider(provider);
  const activeProfileKey = isProfileKey(rawSet.activeProfileKey)
    ? rawSet.activeProfileKey
    : migrateLegacyProfileKey(rawSet.activeProfileKey, activeSeed, provider);

  return {
    ...rawSet,
    provider,
    customProtocol,
    activeProfileKey,
    profiles: migratedProfiles,
  };
}

function profileHasUserData(
  profile: Partial<ProviderProfile> | undefined,
  fallback: ProviderProfile
): boolean {
  if (!profile) {
    return false;
  }
  if (typeof profile.apiKey === 'string' && profile.apiKey.trim()) {
    return true;
  }
  if (
    typeof profile.baseUrl === 'string' &&
    profile.baseUrl.trim() &&
    profile.baseUrl.trim() !== fallback.baseUrl
  ) {
    return true;
  }
  if (
    typeof profile.model === 'string' &&
    profile.model.trim() &&
    profile.model.trim() !== fallback.model
  ) {
    return true;
  }
  return false;
}

/**
 * One-shot migration of legacy multi-provider config to openai/anthropic profiles.
 */
export function migrateLegacyConfig(
  raw: Partial<AppConfig> & Record<string, unknown>
): Partial<AppConfig> {
  const migratedProfiles = mergeLegacyProfiles(
    raw.profiles as Record<string, Partial<ProviderProfile>> | undefined
  );
  const rootModel = typeof raw.model === 'string' ? raw.model : undefined;
  const provider = migrateLegacyProviderType(raw.provider, {
    customProtocol: isCustomProtocol(raw.customProtocol) ? raw.customProtocol : undefined,
    model:
      rootModel ||
      migratedProfiles[raw.activeProfileKey as ProviderProfileKey]?.model ||
      migratedProfiles[migrateLegacyProfileKey(raw.activeProfileKey)]?.model,
  });
  const customProtocol = isCustomProtocol(raw.customProtocol)
    ? raw.customProtocol
    : defaultProtocolForSharedProvider(provider);
  const derivedProfileKey = profileKeyFromProvider(provider, customProtocol);

  let activeProfileKey = isProfileKey(raw.activeProfileKey)
    ? raw.activeProfileKey
    : migrateLegacyProfileKey(
        raw.activeProfileKey,
        typeof raw.activeProfileKey === 'string'
          ? migratedProfiles[migrateLegacyProfileKey(raw.activeProfileKey)]
          : undefined,
        provider
      );

  const hasLegacyFlatFields =
    typeof raw.apiKey === 'string' ||
    typeof raw.baseUrl === 'string' ||
    typeof rootModel === 'string';
  const hasProfileUserData = (['openai', 'anthropic'] as const).some((key) =>
    profileHasUserData(migratedProfiles[key], { apiKey: '', baseUrl: '', model: '' })
  );

  if (hasLegacyFlatFields && !hasProfileUserData) {
    migratedProfiles[derivedProfileKey] = {
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : undefined,
      model: rootModel || '',
    };
    activeProfileKey = derivedProfileKey;
  }

  const configSets = Array.isArray(raw.configSets)
    ? raw.configSets.map((set) => migrateLegacyConfigSet(set as Partial<ApiConfigSet>))
    : raw.configSets;

  if (Array.isArray(configSets) && configSets.length > 0) {
    const activeSet =
      configSets.find((set) => set.id === raw.activeConfigSetId) || configSets[0];
    const setProfiles = mergeLegacyProfiles(
      activeSet?.profiles as Record<string, Partial<ProviderProfile>> | undefined
    );
    for (const key of ['openai', 'anthropic'] as const) {
      const profile = setProfiles[key];
      if (profile && !profileHasUserData(migratedProfiles[key], { apiKey: '', baseUrl: '', model: '' })) {
        migratedProfiles[key] = profile;
      }
    }
  }

  const agentCliPath =
    typeof raw.agentCliPath === 'string' && raw.agentCliPath.trim()
      ? raw.agentCliPath
      : typeof raw.claudeCodePath === 'string' && raw.claudeCodePath.trim()
        ? raw.claudeCodePath
        : typeof raw.agentCliPath === 'string'
          ? raw.agentCliPath
          : undefined;

  return {
    ...raw,
    provider,
    customProtocol,
    activeProfileKey,
    profiles: migratedProfiles,
    configSets: configSets as ApiConfigSet[] | undefined,
    agentCliPath,
  };
}
