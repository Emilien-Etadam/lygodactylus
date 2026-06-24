import type {
  ApiConfigSet,
  AppConfig,
  ApiTestResult,
  CustomProtocolType,
  DiagnosticResult,
  ProviderModelInfo,
  ProviderProfileKey,
  ProviderPresets,
} from '../../types';

export interface UseApiConfigStateOptions {
  enabled?: boolean;
  initialConfig?: AppConfig | null;
  onSave?: (config: Partial<AppConfig>) => Promise<void>;
}

export interface UIProviderProfile {
  apiKey: string;
  baseUrl: string;
  model: string;
  customModel: string;
  useCustomModel: boolean;
  contextWindow: string;
  maxTokens: string;
}

export interface ConfigStateSnapshot {
  activeProfileKey: ProviderProfileKey;
  profiles: Record<ProviderProfileKey, UIProviderProfile>;
  enableThinking: boolean;
}

export interface ApiConfigBootstrap {
  snapshot: ConfigStateSnapshot;
  configSets: ApiConfigSet[];
  activeConfigSetId: string;
}

export type CreateMode = 'blank' | 'clone';

export type PendingConfigSetAction = { type: 'switch'; targetSetId: string };

export const PROFILE_KEYS: ProviderProfileKey[] = [
  'openrouter',
  'anthropic',
  'openai',
  'gemini',
  'ollama',
  'custom:anthropic',
  'custom:openai',
  'custom:gemini',
];

export interface ApiConfigState {
  // Provider presets loaded from Electron
  presets: ProviderPresets;
  // Per-profile UI fields
  profiles: Record<ProviderProfileKey, UIProviderProfile>;
  // Which profile tab is selected
  activeProfileKey: ProviderProfileKey;
  // Config-set list and selection
  configSets: ApiConfigSet[];
  activeConfigSetId: string;
  // Deferred action waiting for unsaved-changes resolution
  pendingConfigSetAction: PendingConfigSetAction | null;
  // Extended thinking flag
  enableThinking: boolean;
  // Remember last custom protocol so switching back to custom restores it
  lastCustomProtocol: CustomProtocolType;
  // Signature of the last persisted state (used for dirty-check)
  savedDraftSignature: string;
  // Ollama model discovery results keyed by profile
  discoveredModels: Partial<Record<ProviderProfileKey, ProviderModelInfo[]>>;
  // Async loading flags
  isLoadingConfig: boolean;
  isSaving: boolean;
  isTesting: boolean;
  isRefreshingModels: boolean;
  isDiscoveringLocalOllama: boolean;
  isMutatingConfigSet: boolean;
  isDiagnosing: boolean;
  // Error message — either a raw string or a i18n key + optional values
  errorText: string;
  errorKey: string | null;
  errorValues: Record<string, string | number> | undefined;
  // Success message — same dual-source pattern
  successText: string;
  successKey: string | null;
  successValues: Record<string, string | number> | undefined;
  // Persisted results
  lastSaveCompletedAt: number;
  testResult: ApiTestResult | null;
  diagnosticResult: DiagnosticResult | null;
}

// ---------------------------------------------------------------------------
// Actions (discriminated union — no plain string payloads where avoidable)
// ---------------------------------------------------------------------------

export type ApiConfigAction =
  // Bulk resets from loaded config
  | {
      type: 'APPLY_LOADED_STATE';
      payload: {
        presets: ProviderPresets;
        profiles: Record<ProviderProfileKey, UIProviderProfile>;
        activeProfileKey: ProviderProfileKey;
        enableThinking: boolean;
        configSets: ApiConfigSet[];
        activeConfigSetId: string;
        lastCustomProtocol: CustomProtocolType;
        savedDraftSignature: string;
      };
    }
  // Active profile key
  | { type: 'SET_ACTIVE_PROFILE_KEY'; payload: ProviderProfileKey }
  // Enable thinking toggle
  | { type: 'SET_ENABLE_THINKING'; payload: boolean }
  // Patch one profile in the profiles map
  | { type: 'PATCH_PROFILE'; profileKey: ProviderProfileKey; patch: Partial<UIProviderProfile> }
  // Replace a profile using a functional updater
  | {
      type: 'UPDATE_PROFILE_FN';
      profileKey: ProviderProfileKey;
      updater: (prev: UIProviderProfile) => UIProviderProfile;
    }
  // Discovered Ollama models
  | {
      type: 'SET_DISCOVERED_MODELS';
      profileKey: ProviderProfileKey;
      models: ProviderModelInfo[];
    }
  | { type: 'CLEAR_DISCOVERED_MODELS'; profileKey: ProviderProfileKey }
  | { type: 'DELETE_DISCOVERED_MODELS'; profileKey: ProviderProfileKey }
  // Config set mutations
  | { type: 'SET_CONFIG_SETS'; payload: ApiConfigSet[] }
  | { type: 'SET_ACTIVE_CONFIG_SET_ID'; payload: string }
  | { type: 'SET_PENDING_CONFIG_SET_ACTION'; payload: PendingConfigSetAction | null }
  // Loading flags
  | { type: 'SET_IS_LOADING_CONFIG'; payload: boolean }
  | { type: 'SET_IS_SAVING'; payload: boolean }
  | { type: 'SET_IS_TESTING'; payload: boolean }
  | { type: 'SET_IS_REFRESHING_MODELS'; payload: boolean }
  | { type: 'SET_IS_DISCOVERING_LOCAL_OLLAMA'; payload: boolean }
  | { type: 'SET_IS_MUTATING_CONFIG_SET'; payload: boolean }
  | { type: 'SET_IS_DIAGNOSING'; payload: boolean }
  // Error message helpers
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_ERROR_KEY'; key: string; values?: Record<string, string | number> }
  | { type: 'SET_ERROR_TEXT'; text: string }
  // Success message helpers
  | { type: 'CLEAR_SUCCESS' }
  | { type: 'SET_SUCCESS_KEY'; key: string; values?: Record<string, string | number> }
  | { type: 'SET_SUCCESS_TEXT'; text: string }
  // Results
  | { type: 'SET_LAST_SAVE_COMPLETED_AT'; payload: number }
  | { type: 'SET_TEST_RESULT'; payload: ApiTestResult | null }
  | { type: 'SET_DIAGNOSTIC_RESULT'; payload: DiagnosticResult | null }
  // Save signature
  | { type: 'SET_SAVED_DRAFT_SIGNATURE'; payload: string }
  // Last custom protocol memory
  | { type: 'SET_LAST_CUSTOM_PROTOCOL'; payload: CustomProtocolType };
