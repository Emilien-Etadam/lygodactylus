import { isLoopbackBaseUrl } from '../../../shared/network/loopback';
import { normalizeOllamaBaseUrl } from '../../../shared/ollama-base-url';
import type {
  AppConfig,
  CustomProtocolType,
  ProviderModelInfo,
  ProviderProfile,
  ProviderProfileKey,
  ProviderPresets,
  ProviderType,
} from '../../types';
import { PROFILE_KEYS, type UIProviderProfile } from './api-config-types';

export function isProfileKey(value: unknown): value is ProviderProfileKey {
  return typeof value === 'string' && PROFILE_KEYS.includes(value as ProviderProfileKey);
}

export function isProviderType(value: unknown): value is ProviderType {
  return (
    value === 'openrouter' ||
    value === 'anthropic' ||
    value === 'custom' ||
    value === 'openai' ||
    value === 'gemini' ||
    value === 'ollama'
  );
}

export function isCustomProtocol(value: unknown): value is CustomProtocolType {
  return value === 'anthropic' || value === 'openai' || value === 'gemini';
}

export function profileKeyFromProvider(
  provider: ProviderType,
  customProtocol: CustomProtocolType = 'anthropic'
): ProviderProfileKey {
  if (provider !== 'custom') {
    return provider;
  }
  if (customProtocol === 'openai') {
    return 'custom:openai';
  }
  if (customProtocol === 'gemini') {
    return 'custom:gemini';
  }
  return 'custom:anthropic';
}

export function profileKeyToProvider(profileKey: ProviderProfileKey): {
  provider: ProviderType;
  customProtocol: CustomProtocolType;
} {
  if (profileKey === 'ollama') {
    return { provider: 'ollama', customProtocol: 'openai' };
  }
  if (profileKey === 'custom:openai') {
    return { provider: 'custom', customProtocol: 'openai' };
  }
  if (profileKey === 'custom:gemini') {
    return { provider: 'custom', customProtocol: 'gemini' };
  }
  if (profileKey === 'custom:anthropic') {
    return { provider: 'custom', customProtocol: 'anthropic' };
  }
  if (profileKey === 'openai') {
    return { provider: 'openai', customProtocol: 'openai' };
  }
  if (profileKey === 'gemini') {
    return { provider: 'gemini', customProtocol: 'gemini' };
  }
  return { provider: profileKey, customProtocol: 'anthropic' };
}

export function isCustomAnthropicLoopbackGateway(baseUrl: string): boolean {
  return isLoopbackBaseUrl(baseUrl);
}

export function isCustomGeminiLoopbackGateway(baseUrl: string): boolean {
  return isLoopbackBaseUrl(baseUrl);
}

export function isCustomOpenAiLoopbackGateway(baseUrl: string): boolean {
  return isLoopbackBaseUrl(baseUrl);
}

export function isLegacyOllamaConfig(
  config: Pick<AppConfig, 'provider' | 'customProtocol' | 'baseUrl'> | null | undefined
): boolean {
  if (!(config?.provider === 'custom' && config.customProtocol === 'openai')) {
    return false;
  }
  const baseUrl = config.baseUrl?.trim();
  if (!baseUrl || !isLoopbackBaseUrl(baseUrl)) {
    return false;
  }
  try {
    const parsed = new URL(baseUrl);
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return port === '11434' && (!pathname || pathname === '/v1');
  } catch {
    return false;
  }
}

export function modelPresetForProfile(profileKey: ProviderProfileKey, presets: ProviderPresets) {
  if (profileKey === 'ollama') {
    return presets.ollama;
  }
  if (profileKey === 'custom:openai') {
    return presets.openai;
  }
  if (profileKey === 'custom:gemini') {
    return presets.gemini;
  }
  if (profileKey === 'custom:anthropic') {
    return presets.custom;
  }
  return presets[profileKey];
}

export function defaultProfileForKey(
  profileKey: ProviderProfileKey,
  presets: ProviderPresets
): UIProviderProfile {
  const preset = modelPresetForProfile(profileKey, presets);
  const prefersCustomInput = profileKey.startsWith('custom:');
  return {
    apiKey: '',
    baseUrl: preset.baseUrl,
    model: profileKey === 'ollama' ? '' : preset.models[0]?.id || '',
    customModel: '',
    useCustomModel: prefersCustomInput,
    contextWindow: '',
    maxTokens: '',
  };
}

export function normalizeDiscoveredOllamaModels(models: string[] | undefined): ProviderModelInfo[] {
  return (models || [])
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => ({ id, name: id }));
}

function isPristineCustomProfile(
  profileKey: ProviderProfileKey,
  profile: Partial<ProviderProfile> | undefined,
  fallback: UIProviderProfile
): boolean {
  if (!profileKey.startsWith('custom:') || !profile) {
    return false;
  }

  const apiKey = profile.apiKey?.trim() || '';
  const baseUrl = profile.baseUrl?.trim() || fallback.baseUrl;
  const model = profile.model?.trim() || fallback.model;

  return apiKey === '' && baseUrl === fallback.baseUrl && model === fallback.model;
}

export function normalizeProfile(
  profileKey: ProviderProfileKey,
  profile: Partial<ProviderProfile> | undefined,
  presets: ProviderPresets
): UIProviderProfile {
  const fallback = defaultProfileForKey(profileKey, presets);
  if (!profile) {
    return fallback;
  }

  if (isPristineCustomProfile(profileKey, profile, fallback)) {
    return {
      ...fallback,
      apiKey: '',
      baseUrl: fallback.baseUrl,
      customModel: '',
      useCustomModel: true,
      contextWindow: '',
      maxTokens: '',
    };
  }

  const modelValue = profile?.model?.trim() || fallback.model;
  const rawBaseUrl = profile?.baseUrl?.trim() || fallback.baseUrl;
  const hasPresetModel = modelPresetForProfile(profileKey, presets).models.some(
    (item) => item.id === modelValue
  );
  return {
    apiKey: profile?.apiKey || '',
    baseUrl:
      profileKey === 'ollama' ? normalizeOllamaBaseUrl(rawBaseUrl) || fallback.baseUrl : rawBaseUrl,
    model: hasPresetModel ? modelValue : fallback.model,
    customModel: hasPresetModel ? '' : modelValue,
    useCustomModel: !hasPresetModel,
    contextWindow: profile?.contextWindow ? String(profile.contextWindow) : '',
    maxTokens: profile?.maxTokens ? String(profile.maxTokens) : '',
  };
}
