import type { SessionMode } from '../../shared/session-mode';
import type { SessionAutonomy } from '../../shared/session-autonomy';
import type { ChatFolder } from '../../shared/chat-folders';

export type { SessionMode, SessionAutonomy, ChatFolder };

// Session types
export interface Session {
  id: string;
  title: string;
  claudeSessionId?: string;
  openaiThreadId?: string;
  status: SessionStatus;
  cwd?: string;
  mountedPaths: MountedPath[];
  allowedTools: string[];
  memoryEnabled: boolean;
  /** Plan = read-only exploration; Act = full tools (default). */
  mode: SessionMode;
  /** Careful / Normal / Autonomous — orthogonal to Plan/Act (default normal). */
  autonomy: SessionAutonomy;
  model?: string;
  /** Sidebar folder id when grouped; null/undefined at root. */
  folderId?: string | null;
  /** Parent session id for sub-chats; null/undefined for top-level sessions. */
  parentSessionId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export type SessionStatus = 'idle' | 'running' | 'completed' | 'error';

export interface MountedPath {
  virtual: string;
  real: string;
}

// Message types
export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: ContentBlock[];
  timestamp: number;
  api?: string;
  provider?: string;
  model?: string;
  tokenUsage?: TokenUsage;
  localStatus?: 'queued' | 'cancelled';
  executionTimeMs?: number;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export type ContentBlock =
  | TextContent
  | ImageContent
  | FileAttachmentContent
  | ToolUseContent
  | ToolResultContent
  | ThinkingContent
  | CompactionSummaryContent;

export interface CompactionSummaryContent {
  type: 'compaction_summary';
  summary: string;
  tokensBefore: number;
  customInstructions?: string;
  sourceTitle?: string;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export interface FileAttachmentContent {
  type: 'file_attachment';
  filename: string;
  relativePath: string; // Path relative to session's .tmp folder
  size: number;
  mimeType?: string;
  inlineDataBase64?: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  displayName?: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
  images?: Array<{
    data: string; // base64 encoded image data
    mimeType: string; // e.g., 'image/png'
  }>;
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
}

export interface TokenUsage {
  input: number;
  output: number;
}

// Trace types for visualization
export interface TraceStep {
  id: string;
  type: TraceStepType;
  status: TraceStepStatus;
  title: string;
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  isError?: boolean;
  timestamp: number;
  duration?: number;
}

export type TraceStepType = 'thinking' | 'text' | 'tool_call' | 'tool_result';
export type TraceStepStatus = 'pending' | 'running' | 'completed' | 'error';

export type ScheduleRepeatUnit = 'minute' | 'hour' | 'day';
export type ScheduleWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface DailyScheduleConfig {
  kind: 'daily';
  times: string[];
}

export interface WeeklyScheduleConfig {
  kind: 'weekly';
  weekdays: ScheduleWeekday[];
  times: string[];
}

export type ScheduleConfig = DailyScheduleConfig | WeeklyScheduleConfig;

export interface ScheduleTask {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  runAt: number;
  nextRunAt: number | null;
  scheduleConfig: ScheduleConfig | null;
  repeatEvery: number | null;
  repeatUnit: ScheduleRepeatUnit | null;
  enabled: boolean;
  lastRunAt: number | null;
  lastRunSessionId: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleCreateInput {
  title?: string;
  prompt: string;
  cwd: string;
  runAt: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
}

export interface ScheduleUpdateInput {
  title?: string;
  prompt?: string;
  cwd?: string;
  runAt?: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
  lastRunAt?: number | null;
  lastRunSessionId?: string | null;
  lastError?: string | null;
}

// Skills types
export interface Skill {
  id: string;
  name: string;
  description?: string;
  type: SkillType;
  enabled: boolean;
  config?: Record<string, unknown>;
  createdAt: number;
}

export type SkillType = 'builtin' | 'mcp' | 'custom';

export type PluginComponentKind = 'skills' | 'commands' | 'agents' | 'hooks' | 'mcp';

export interface PluginComponentCounts {
  skills: number;
  commands: number;
  agents: number;
  hooks: number;
  mcp: number;
}

export interface PluginComponentEnabledState {
  skills: boolean;
  commands: boolean;
  agents: boolean;
  hooks: boolean;
  mcp: boolean;
}

export type {
  CatalogEntry,
  CatalogEntryType,
  CatalogManifest,
  CatalogManifestMeta,
  CatalogManifestSource,
  CatalogSource,
  CatalogSourceStatus,
  MarketplaceEntry,
  MarketplaceInstallResult,
  MarketplaceInstallState,
  MarketplaceInstalledRecord,
  MarketplaceIntegrityResult,
  SkillIntegrityStatus,
} from '../../shared/catalog-types';

export interface InstalledPlugin {
  pluginId: string;
  name: string;
  description?: string;
  version?: string;
  authorName?: string;
  enabled: boolean;
  sourcePath: string;
  runtimePath: string;
  componentCounts: PluginComponentCounts;
  componentsEnabled: PluginComponentEnabledState;
  installedAt: number;
  updatedAt: number;
}

export interface PluginInstallResultV2 {
  plugin: InstalledPlugin;
  installedSkills: string[];
  warnings: string[];
}

export interface PluginToggleResult {
  success: boolean;
  plugin: InstalledPlugin;
}

export interface PluginInstallResult {
  pluginName: string;
  installedSkills: string[];
  skippedSkills: string[];
  errors: string[];
}

export interface SkillsStorageChangeEvent {
  path: string;
  reason: 'updated' | 'path_changed' | 'fallback' | 'watcher_error';
  message?: string;
}

// Memory types
export interface MemoryEntry {
  id: string;
  sessionId: string;
  content: string;
  metadata: MemoryMetadata;
  createdAt: number;
}

export interface MemoryMetadata {
  source: string;
  timestamp: number;
  tags: string[];
}

export type MemorySearchScope = 'workspace' | 'global' | 'all';
export type MemorySearchKind = 'core' | 'experience_session' | 'experience_chunk' | 'raw_session';

export interface MemoryTranscriptTurn {
  role: string;
  content: string;
  messageId?: string;
  timestamp?: number;
}

export interface ChunkMemoryItem {
  id: string;
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceWorkspaceLabel?: string;
  sourceSessionId: string;
  sourceSessionTitle?: string;
  sourceSessionDate?: string;
  summary: string;
  details: string;
  keywords: string[];
  sourceTurns: number[];
  rawText: string;
  sessionDate: string;
  createdAt: string;
  ingestedAt: string;
  /** Confiance optionnelle [0, 1] ; absente → neutre côté ranker. */
  confidence?: number;
  embedding: number[];
}

export interface SessionMemoryItem {
  id: string;
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceWorkspaceLabel?: string;
  sourceSessionId: string;
  sourceSessionTitle?: string;
  sourceSessionDate?: string;
  summary: string;
  keywords: string[];
  chunkIds: string[];
  rawSession: MemoryTranscriptTurn[];
  sessionDate: string;
  createdAt: string;
  ingestedAt: string;
  /** Confiance optionnelle [0, 1] ; absente → neutre côté ranker. */
  confidence?: number;
  embedding: number[];
}

export interface MemoryDebugFileInfo {
  kind: 'core' | 'experience' | 'state' | 'artifacts';
  label: string;
  filePath: string;
  exists: boolean;
  sizeBytes: number;
  updatedAt: number | null;
  sessionCount?: number;
  chunkCount?: number;
}

export interface MemoryDebugFileContent {
  kind: MemoryDebugFileInfo['kind'];
  filePath: string;
  text: string;
  parsed: unknown | null;
  sizeBytes: number;
  updatedAt: number | null;
}

export interface MemoryInspectSessionResult {
  sourceWorkspace?: string | null;
  filePath: string;
  session: SessionMemoryItem;
  chunks: ChunkMemoryItem[];
}

export interface MemoryOverview {
  enabled: boolean;
  storageRoot: string;
  coreFilePath: string;
  experienceFilePath: string;
  stateFilePath: string;
  coreCount: number;
  experienceSessionCount: number;
  experienceChunkCount: number;
  sourceWorkspaceCount: number;
  failedSessionCount: number;
  latestIngestionAt: number | null;
  latestError: string | null;
  currentWorkspace?: {
    workspaceKey: string;
    experienceSessionCount: number;
    experienceChunkCount: number;
  };
  topSourceWorkspaces: Array<{
    workspaceKey: string;
    sessionCount: number;
    chunkCount: number;
  }>;
}

export interface MemorySearchResult {
  id: string;
  recordId: string;
  kind: MemorySearchKind;
  title: string;
  summary: string;
  contentPreview: string;
  workspaceKey?: string;
  sourceWorkspace?: string | null;
  sourceWorkspaceLabel?: string;
  sourceSessionId?: string;
  sourceSessionTitle?: string;
  sessionId?: string;
  sessionTitle?: string;
  category?: 'identity' | 'preferences' | 'skills' | 'interests';
  score: number;
  createdAt: number;
  updatedAt?: number;
  keywords?: string[];
  sourceFile?: string;
}

export interface MemoryReadResult extends MemorySearchResult {
  rawText?: string;
  details?: string;
  rawSession?: MemoryTranscriptTurn[];
  sourceTurns?: number[];
  chunkIds?: string[];
  sourceExcerpt?: string;
}

// Permission types
/** Optional unified-diff payload for careful-mode write/edit approval. */
export interface PermissionDiffPayload {
  path: string;
  oldContent?: string;
  newContent: string;
  unifiedDiff: string;
  changeBytes: number;
  isNewFile: boolean;
}

export interface PermissionRequest {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  sessionId: string;
  /** Present when careful mode asks for a per-edit approval. */
  diff?: PermissionDiffPayload;
  /** Show "approve all for this run" (careful mode). */
  allowRunOption?: boolean;
}

export type PermissionResult = 'allow' | 'deny' | 'allow_always' | 'allow_run';

// Sudo password types
export interface SudoPasswordRequest {
  toolUseId: string;
  command: string;
  sessionId: string;
}

// AskUserQuestion types
export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export interface UserQuestionRequest {
  questionId: string;
  sessionId: string;
  toolUseId: string;
  questions: QuestionItem[];
}

export interface UserQuestionResponse {
  questionId: string;
  answer: string;
}

export interface PermissionRule {
  tool: string;
  pattern?: string;
  action: 'allow' | 'deny' | 'ask';
}

// IPC Event types
export type ClientEvent =
  | {
      type: 'session.start';
      payload: {
        title: string;
        prompt: string;
        cwd?: string;
        allowedTools?: string[];
        content?: ContentBlock[];
        memoryEnabled?: boolean;
        messageId?: string;
        /** Optional Plan/Act mode at creation (e.g. Quick Ask → 'plan'). */
        mode?: SessionMode;
      };
    }
  | {
      type: 'session.continue';
      payload: { sessionId: string; prompt: string; content?: ContentBlock[]; messageId?: string };
    }
  | { type: 'session.stop'; payload: { sessionId: string } }
  | {
      type: 'session.compact';
      payload: { sessionId: string; customInstructions?: string };
    }
  | {
      type: 'session.handoff';
      payload: { sessionId: string; customInstructions?: string; messageId?: string };
    }
  | {
      type: 'session.forkFromMessage';
      payload: { sessionId: string; messageId: string; asSubChat?: boolean };
    }
  | {
      type: 'session.rewindToMessage';
      payload: { sessionId: string; messageId: string };
    }
  | { type: 'session.delete'; payload: { sessionId: string } }
  | { type: 'session.batchDelete'; payload: { sessionIds: string[] } }
  | { type: 'session.setMemoryEnabled'; payload: { sessionId: string; memoryEnabled: boolean } }
  | { type: 'session.setMode'; payload: { sessionId: string; mode: SessionMode } }
  | { type: 'session.getMode'; payload: { sessionId: string } }
  | {
      type: 'session.setAutonomy';
      payload: { sessionId: string; autonomy: SessionAutonomy };
    }
  | { type: 'session.getAutonomy'; payload: { sessionId: string } }
  | { type: 'session.list'; payload: Record<string, never> }
  | { type: 'session.getMessages'; payload: { sessionId: string } }
  | { type: 'session.getTraceSteps'; payload: { sessionId: string } }
  | { type: 'permission.response'; payload: { toolUseId: string; result: PermissionResult } }
  | { type: 'question.response'; payload: UserQuestionResponse }
  | { type: 'sudo.password.response'; payload: { toolUseId: string; password: string | null } }
  | { type: 'settings.update'; payload: Record<string, unknown> }
  | { type: 'folder.select'; payload: Record<string, never> }
  | { type: 'workdir.get'; payload: Record<string, never> }
  | { type: 'workdir.set'; payload: { path: string; sessionId?: string } }
  | { type: 'workdir.select'; payload: { sessionId?: string; currentPath?: string } };

// Sandbox setup types (app startup)
export type SandboxSetupPhase =
  | 'checking' // Checking WSL/Lima availability
  | 'creating' // Creating Lima instance (macOS only)
  | 'starting' // Starting Lima instance (macOS only)
  | 'installing_node' // Installing Node.js
  | 'installing_python' // Installing Python
  | 'installing_pip' // Installing pip
  | 'installing_deps' // Installing skill dependencies (markitdown, pypdf, etc.)
  | 'ready' // Ready to use
  | 'skipped' // No sandbox needed (native mode)
  | 'error'; // Setup failed

export interface SandboxSetupProgress {
  phase: SandboxSetupPhase;
  message: string;
  detail?: string;
  progress?: number; // 0-100
  error?: string;
}

// Sandbox sync types (per-session file sync)
export type SandboxSyncPhase =
  | 'starting_agent' // Starting WSL/Lima agent
  | 'syncing_files' // Syncing files to sandbox
  | 'syncing_skills' // Copying skills
  | 'ready' // Sync complete
  | 'error'; // Sync failed

export interface SandboxSyncStatus {
  sessionId: string;
  phase: SandboxSyncPhase;
  message: string;
  detail?: string;
  fileCount?: number;
  totalSize?: number;
}

export type ServerEvent =
  | { type: 'stream.message'; payload: { sessionId: string; message: Message } }
  | { type: 'stream.partial'; payload: { sessionId: string; delta: string } }
  | { type: 'stream.thinking'; payload: { sessionId: string; delta: string } }
  | {
      type: 'stream.executionTime';
      payload: { sessionId: string; messageId: string; executionTimeMs: number };
    }
  | {
      type: 'session.status';
      payload: { sessionId: string; status: SessionStatus; error?: string };
    }
  | { type: 'session.update'; payload: { sessionId: string; updates: Partial<Session> } }
  | {
      type: 'session.list';
      payload: { sessions: Session[]; folders?: ChatFolder[] };
    }
  | { type: 'permission.request'; payload: PermissionRequest }
  | { type: 'permission.dismiss'; payload: { toolUseId: string } }
  | { type: 'question.request'; payload: UserQuestionRequest }
  | { type: 'question.dismiss'; payload: { questionId: string; toolUseId: string } }
  | { type: 'sudo.password.request'; payload: SudoPasswordRequest }
  | { type: 'sudo.password.dismiss'; payload: { toolUseId: string } }
  | { type: 'trace.step'; payload: { sessionId: string; step: TraceStep } }
  | {
      type: 'trace.update';
      payload: { sessionId: string; stepId: string; updates: Partial<TraceStep> };
    }
  | { type: 'folder.selected'; payload: { path: string } }
  | { type: 'config.status'; payload: { isConfigured: boolean; config: AppConfig } }
  | {
      type: 'checkpoint.runReady';
      payload: {
        sessionId: string;
        runId: string;
        messageIds: string[];
        partialCoverage: boolean;
        files: Array<{ path: string; action: 'modified' | 'created' }>;
      };
    }
  | { type: 'sandbox.progress'; payload: SandboxSetupProgress }
  | { type: 'sandbox.sync'; payload: SandboxSyncStatus }
  | { type: 'skills.storageChanged'; payload: SkillsStorageChangeEvent }
  | {
      type: 'plugins.runtimeApplied';
      payload: { sessionId: string; plugins: Array<{ name: string; path: string }> };
    }
  | { type: 'plugins.commandsChanged'; payload: Record<string, never> }
  | { type: 'update.checkResult'; payload: import('../../shared/update-check').UpdateCheckResult }
  | { type: 'workdir.changed'; payload: { path: string } }
  | {
      type: 'session.memoryContext';
      payload: { sessionId: string; items: MemoryInjectedItem[] };
    }
  | {
      type: 'session.attachedContext';
      payload: { sessionId: string; items: AttachedContextItem[] };
    }
  | {
      type: 'session.contextInfo';
      payload: {
        sessionId: string;
        contextWindow: number;
        maxTokens: number;
        /** Ollama /api/show parameter_size when known. */
        parameterSize?: string;
        /** Ollama /api/show quantization_level when known. */
        quantization?: string;
        /** Workspace-root rules file basename when loaded (AGENTS.md / .rules / CLAUDE.md). */
        projectRulesFile?: string | null;
      };
    }
  | {
      type: 'session.notice';
      payload: {
        sessionId: string;
        message: string;
        noticeType: 'info' | 'warning' | 'error' | 'success';
      };
    }
  | {
      type: 'navigate.to';
      payload: { page: 'welcome' | 'settings' | 'session'; tab?: string; sessionId?: string };
    }
  | {
      type: 'quickAsk.status';
      payload: {
        enabled: boolean;
        shortcut: string;
        registered: boolean;
        error: string | null;
      };
    }
  | { type: 'quickAsk.opened' }
  | { type: 'native-theme.changed'; payload: { shouldUseDarkColors: boolean } }
  | { type: 'new-session' }
  | { type: 'navigate'; payload: string }
  | { type: 'scheduled-task.error'; payload: { taskId: string; error: string } }
  | {
      type: 'error';
      payload: {
        message: string;
        code?: 'CONFIG_REQUIRED_ACTIVE_SET';
        action?: 'open_api_settings';
      };
    };

// Settings types
export interface Settings {
  theme: AppTheme;
  apiKey?: string;
  defaultTools: string[];
  permissionRules: PermissionRule[];
  globalSkillsPath: string;
  memoryStrategy: 'auto' | 'manual' | 'rolling';
  maxContextTokens: number;
}

// Tool types
export type ToolName =
  | 'read'
  | 'write'
  | 'edit'
  | 'glob'
  | 'grep'
  | 'bash'
  | 'webFetch'
  | 'webSearch';

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

// Execution context
export interface ExecutionContext {
  sessionId: string;
  cwd: string;
  mountedPaths: MountedPath[];
  allowedTools: string[];
}

// App Config types
export type ProviderType = 'openai' | 'anthropic';
export type CustomProtocolType = 'anthropic' | 'openai';
export type AppTheme = 'dark' | 'light' | 'system';
export type ProviderProfileKey = 'openai' | 'anthropic';
export type ConfigSetId = string;

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

export interface CreateSetPayload {
  name: string;
  mode: 'blank' | 'clone';
  fromSetId?: string;
}

export interface MemoryModelRuntimeConfig {
  inheritFromActive: boolean;
  provider?: ProviderType;
  customProtocol?: CustomProtocolType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs: number;
}

export interface MemoryRerankerConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  topN: number;
  keep: number;
  timeoutMs: number;
}

export interface MemoryRuntimeConfig {
  llm: MemoryModelRuntimeConfig;
  embedding: MemoryModelRuntimeConfig;
  useEmbedding: boolean;
  /** Opt-in workspace semantic_search tool (OFF by default). */
  semanticSearchEnabled: boolean;
  maxNavSteps: number;
  ingestionConcurrency: number;
  chunkTopK: number;
  sessionTopK: number;
  injectionPolicy: 'escape' | 'strip-suspicious' | 'block';
  showInjectedMemoryInChat: boolean;
  memoryReranker: MemoryRerankerConfig;
  storageRoot?: string;
  evalEnabled?: boolean;
  evalWorkspaces?: string[];
  evalMaxRounds?: number;
  evalArtifactsRoot?: string;
  promptIterationRounds?: number;
}

export interface MemoryRerankerTestInput {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}

export interface MemoryRerankerTestResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface MemoryInjectedItem {
  kind: 'core' | 'chunk' | 'session';
  id: string;
  title: string;
  summary: string;
  score?: number;
  sourceWorkspace?: string | null;
  sourceSessionId?: string;
  sourceSessionTitle?: string;
}

export interface AttachedContextItem {
  source: string;
  kind: 'file' | 'directory' | 'url';
  body: string;
  ok: boolean;
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
  defaultWorkdir?: string;
  globalSkillsPath?: string;
  theme?: AppTheme;
  uiLanguage?: string;
  sandboxEnabled?: boolean;
  sandboxLanNetworkEnabled?: boolean;
  memoryEnabled?: boolean;
  memoryRuntime?: MemoryRuntimeConfig;
  webSearch?: WebSearchConfig;
  enableThinking?: boolean;
  thinkingLevel?: ThinkingLevel;
  speechSynthesisEnabled?: boolean;
  /** Show model stats (tok/s, context %, params/quant). On by default. */
  modelStatsEnabled?: boolean;
  /**
   * Capture pre-images before agent write/edit (and best-effort bash via watcher)
   * so the user can undo a run without git. On by default.
   */
  checkpointsEnabled?: boolean;
  /** Per-workspace lint/test commands for autonomous mode. */
  workspaceTooling?: Record<string, { lintCmd?: string; testCmd?: string }>;
  /** Global Quick Ask floating window. Off by default. */
  quickAskEnabled?: boolean;
  /** Electron Accelerator for the Quick Ask global shortcut. */
  quickAskShortcut?: string;
  /** Ollama keep_alive duration (e.g. "30m"). Soft-defaulted in main when missing. */
  ollamaKeepAlive?: string;
  /** 'auto' enables server-side JSON schema constraints when probed; 'off' disables. */
  constrainedOutput?: 'auto' | 'off';
  constrainedOutputCapability?: {
    baseUrl: string;
    model: string;
    supported: boolean;
    field: 'ollama_format' | 'openai_json_schema' | null;
    probedAt: string;
  } | null;
  isConfigured: boolean;
}

export type ThinkingLevel = 'low' | 'medium' | 'high';

export type WebSearchProvider = 'duckduckgo' | 'searxng' | 'yacy';

export interface WebSearchConfig {
  provider: WebSearchProvider;
  baseUrl?: string;
  authToken?: string;
  language?: string;
  categories?: string;
  safeSearch?: 0 | 1 | 2;
  maxResults?: number;
  timeoutMs?: number;
}

export interface WebSearchTestInput {
  provider: WebSearchProvider;
  baseUrl?: string;
  authToken?: string;
  language?: string;
  categories?: string;
  safeSearch?: 0 | 1 | 2;
  query?: string;
}

export interface WebSearchTestResult {
  ok: boolean;
  resultCount?: number;
  preview?: string;
  error?: string;
}

export interface ProviderPreset {
  name: string;
  baseUrl: string;
  models: { id: string; name: string }[];
  keyPlaceholder: string;
  keyHint: string;
}

export interface ProviderPresets {
  openai: ProviderPreset;
  anthropic: ProviderPreset;
}

export interface ProviderModelInfo {
  id: string;
  name: string;
  /** Serving context window reported by the endpoint (e.g. vLLM max_model_len), when available. */
  contextWindow?: number;
}

export interface ApiTestInput {
  provider: AppConfig['provider'];
  apiKey: string;
  baseUrl?: string;
  customProtocol?: AppConfig['customProtocol'];
  model?: string;
  useLiveRequest?: boolean;
  verificationLevel?: DiagnosticVerificationLevel;
}

export interface ApiTestResult {
  ok: boolean;
  latencyMs?: number;
  status?: number;
  errorType?:
    | 'missing_key'
    | 'missing_base_url'
    | 'unauthorized'
    | 'not_found'
    | 'rate_limited'
    | 'server_error'
    | 'network_error'
    | 'ollama_not_running'
    | 'ollama_loading'
    | 'unknown';
  details?: string;
}

// API Diagnostics types
export type DiagnosticStepName = 'dns' | 'tcp' | 'tls' | 'auth' | 'model';
export type DiagnosticStepStatus = 'pending' | 'running' | 'ok' | 'fail' | 'skip';
export type DiagnosticVerificationLevel = 'fast' | 'deep';
export type DiagnosticAdvisoryCode = 'not_deep_verified' | 'model_loading' | 'manual_model';

export interface DiagnosticStep {
  name: DiagnosticStepName;
  status: DiagnosticStepStatus;
  latencyMs?: number;
  error?: string;
  fix?: string;
}

export interface DiagnosticResult {
  steps: DiagnosticStep[];
  overallOk: boolean;
  /** Which step failed first (null if all ok) */
  failedAt?: DiagnosticStepName;
  totalLatencyMs: number;
  verificationLevel?: DiagnosticVerificationLevel;
  advisoryCode?: DiagnosticAdvisoryCode;
  advisoryText?: string;
  /** Present when the run was skipped (e.g. 'concurrent_run') */
  skippedReason?: string;
}

export interface DiagnosticInput {
  provider: AppConfig['provider'];
  apiKey: string;
  baseUrl?: string;
  customProtocol?: AppConfig['customProtocol'];
  model?: string;
  verificationLevel?: DiagnosticVerificationLevel;
}

export interface LocalServiceInfo {
  type: 'ollama';
  baseUrl: string;
  models?: string[];
}

export type LocalOllamaDiscoveryStatus = 'unavailable' | 'service_available' | 'models_available';

export interface LocalOllamaDiscoveryResult {
  available: boolean;
  baseUrl: string;
  models?: string[];
  status: LocalOllamaDiscoveryStatus;
}

// MCP types
export interface MCPServerInfo {
  id: string;
  name: string;
  connected: boolean;
  toolCount: number;
  tools?: MCPToolInfo[];
}

export interface MCPToolInfo {
  name: string;
  description: string;
  serverId: string;
  serverName: string;
}

export type {
  PromptPreset,
  PromptPresetCreateInput,
  PromptPresetUpdateInput,
} from '../../shared/prompt-presets';
