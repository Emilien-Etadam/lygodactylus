import {
  createAgentSession,
  SessionManager as PiSessionManager,
  SettingsManager as PiSettingsManager,
  createBashToolDefinition,
  getAgentDir,
  type AgentSession as PiAgentSession,
  type BashToolOptions,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent';
import * as path from 'path';
import type { BeforeSessionRunResult } from '../extensions/agent-runtime-extension';
import { configStore } from '../config/config-store';
import { normalizeOpenAICompatibleBaseUrl } from '../config/auth-utils';
import { fetchOllamaModelInfo } from '../config/ollama-api';
import type { SandboxAdapter } from '../sandbox/sandbox-adapter';
import { wslUnixPathToWindowsUnc } from '../sandbox/sandbox-workspace-path';
import { log, logCtx, logCtxWarn, logError, logTiming, logWarn } from '../utils/logger';
import { buildColdStartContextualPrompt } from './agent-runner-history';
import { getBundledNodePaths, enrichProcessPathForBuild } from './agent-runner-path-env';
import {
  type CachedPiSession,
  evictOldestPiSession,
  installPermissionHook,
  wrapBashToolForSudo,
  wrapBashToolWithDefaultTimeout,
} from './agent-runner-pi-session';
import {
  AgentRunnerRunContext,
  ensureSkillsSetup,
  VIRTUAL_WORKSPACE_PATH,
} from './agent-runner-run-context';
import { getSharedAuthStorage, ModelRegistry } from './shared-auth';
import {
  buildCompactionSettings,
  estimateTokensFromText,
  getLastInputTokenCount,
} from './context-budget';
import {
  applyPiModelRuntimeOverrides,
  buildSyntheticPiModel,
  resolvePiRegistryModel,
  resolvePiRouteProtocol,
  resolveSyntheticPiModelFallback,
} from './pi-model-resolution';
import { buildPiSessionRuntimeSignature } from './pi-session-runtime';
import { buildMcpCustomTools, safeStringify, toErrorText } from './agent-runner-mcp-bridge';
import { createWindowsBashOperations } from './windows-bash-operations';
import { createWslSandboxBashOperations } from './wsl-sandbox-bash-operations';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import type { Message, Session } from '../../renderer/types';

type PiModel = ReturnType<typeof buildSyntheticPiModel>;

export interface PreparedPiSessionRun {
  piSession: PiAgentSession;
  cachedSession?: CachedPiSession;
  provider: string;
  runtimeConfig: ReturnType<typeof configStore.getAll>;
  usedSyntheticModel: boolean;
  piModel: PiModel;
  contextualPrompt: string;
  modelContextWindow: number;
  modelMaxTokens: number;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  promptPrefix?: string;
  compactionEnabled: boolean;
}

interface PreparePiSessionRunOptions {
  ctx: AgentRunnerRunContext;
  session: Session;
  prompt: string;
  existingMessages: Message[];
  workingDir?: string;
  sandboxPath: string | null;
  useSandboxIsolation: boolean;
  sandbox: SandboxAdapter;
  runStartTime: number;
}

function buildWorkspaceInfoPrompt(
  workingDir: string | undefined,
  sandboxPath: string | null,
  useSandboxIsolation: boolean
): string {
  if (useSandboxIsolation && sandboxPath) {
    return `<workspace_info>
Your current workspace is located at: ${VIRTUAL_WORKSPACE_PATH}
This is an isolated sandbox environment. Use ${VIRTUAL_WORKSPACE_PATH} as the root path for file operations.
</workspace_info>`;
  }
  return workingDir
    ? `<workspace_info>Your current workspace is: ${workingDir}</workspace_info>`
    : '';
}

function buildCoworkAppendPrompt(
  ctx: AgentRunnerRunContext,
  workingDir: string | undefined,
  sandboxPath: string | null,
  useSandboxIsolation: boolean
): string[] {
  const workspaceInfoPrompt = buildWorkspaceInfoPrompt(
    workingDir,
    sandboxPath,
    useSandboxIsolation
  );
  return [
    'You are an Open Cowork assistant. Be concise, accurate, and tool-capable.',
    `CRITICAL BEHAVIORAL RULES:
1. CHAT FIRST: By default, respond to the user in plain text within the conversation. Do NOT create, write, or edit files unless the user explicitly asks you to (e.g., "create a file", "write this to...", "edit the code", "save as...", mentions a specific file path, or describes code changes they want applied). For questions, summaries, explanations, analysis, and general conversation — always reply directly in chat text.
2. When a request is actionable, proceed immediately with reasonable assumptions. If you need clarification, ask briefly in plain text.
3. For relative time windows like "within two days" in browsing or research tasks, assume the most recent two relevant publication days unless the user explicitly defines another date range.
4. For bracketed placeholders like [Agent], [Topic], etc., treat the word inside brackets as the literal search keyword unless the user says otherwise.
5. When given a task, START DOING IT. Do not restate the task, do not list what you will do, do not ask for confirmation. Just execute.`,
    workspaceInfoPrompt,
    `<citation_requirements>
If your answer uses linkable content from MCP tools, include a "Sources:" section and otherwise use standard Markdown links: [Title](https://claude.ai/chat/URL).
</citation_requirements>`,
    `<tool_behavior>
Tool routing:
- If user explicitly asks to use Chrome/browser/web navigation, prioritize Chrome MCP tools (mcp__Chrome__*) over generic WebSearch/WebFetch.
- Use WebSearch/WebFetch only when Chrome MCP is unavailable or the user explicitly asks for generic web search.
</tool_behavior>`,
    ctx.skillsPaths.getBundledPathHints(),
  ].filter((section): section is string => Boolean(section && section.trim()));
}

function logMcpServersSummary(mcpServers: Record<string, unknown>): void {
  const summary = Object.entries(mcpServers).map(([name, serverConfig]) => {
    const typedServerConfig = serverConfig as {
      type?: string;
      command?: string;
      args?: unknown[];
      env?: Record<string, unknown>;
    };
    return {
      name,
      type: typedServerConfig.type ?? 'unknown',
      command: typedServerConfig.command ?? '',
      argsCount: Array.isArray(typedServerConfig.args) ? typedServerConfig.args.length : 0,
      envKeys: typedServerConfig.env ? Object.keys(typedServerConfig.env).length : 0,
    };
  });
  log('[ClaudeAgentRunner] Final mcpServers summary:', safeStringify(summary, 2));
  if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === '1') {
    log('[ClaudeAgentRunner] Final mcpServers config:', safeStringify(mcpServers, 2));
  }
}

function buildMcpServers(
  ctx: AgentRunnerRunContext,
  imageCapable: boolean
): Record<string, unknown> {
  const mcpServers: Record<string, unknown> = {};
  if (!ctx.mcpManager) {
    return mcpServers;
  }

  const serverStatuses = ctx.mcpManager.getServerStatus();
  const connectedServers = serverStatuses.filter((status) => status.connected);
  log('[ClaudeAgentRunner] MCP server statuses:', safeStringify(serverStatuses));
  log('[ClaudeAgentRunner] Connected MCP servers:', connectedServers.length);

  let allConfigs: ReturnType<typeof mcpConfigStore.getEnabledServers> = [];
  try {
    allConfigs = mcpConfigStore.getEnabledServers();
    log(
      '[ClaudeAgentRunner] Enabled MCP configs:',
      allConfigs.map((config) => config.name)
    );
  } catch (error) {
    logWarn(
      '[ClaudeAgentRunner] Failed to read enabled MCP configs; MCP tools will be unavailable this query',
      error
    );
  }

  const mcpFingerprint = JSON.stringify(allConfigs) + String(imageCapable);
  const cachedMcpServers = ctx.getMcpServersCache();
  if (cachedMcpServers?.fingerprint === mcpFingerprint) {
    Object.assign(mcpServers, cachedMcpServers.servers);
    log('[ClaudeAgentRunner] MCP servers config reused from cache');
    logMcpServersSummary(mcpServers);
    return mcpServers;
  }

  const bundledNodePaths = getBundledNodePaths();
  const bundledNpx = bundledNodePaths?.npx ?? null;

  for (const config of allConfigs) {
    try {
      const serverKey = config.name;
      if (config.type === 'stdio') {
        const command =
          config.command === 'npx' && bundledNpx
            ? bundledNpx
            : config.command === 'node' && bundledNodePaths
              ? bundledNodePaths.node
              : config.command;

        const serverEnv = { ...config.env };
        if (bundledNodePaths && (config.command === 'npx' || config.command === 'node')) {
          const nodeBinDir = path.dirname(bundledNodePaths.node);
          const currentPath = process.env.PATH || '';
          serverEnv.PATH = `${nodeBinDir}${path.delimiter}${currentPath}`;
          log(`[ClaudeAgentRunner]   Added bundled node bin to PATH: ${nodeBinDir}`);
        }

        if (!imageCapable) {
          serverEnv.OPEN_COWORK_DISABLE_IMAGE_TOOL_OUTPUT = '1';
        }

        let resolvedArgs = config.args || [];
        const hasPlaceholders = resolvedArgs.some(
          (arg) =>
            arg.includes('{SOFTWARE_DEV_SERVER_PATH}') || arg.includes('{GUI_OPERATE_SERVER_PATH}')
        );
        if (hasPlaceholders) {
          let presetKey: string | null = null;
          if (config.name === 'Software_Development' || config.name === 'Software Development') {
            presetKey = 'software-development';
          } else if (config.name === 'GUI_Operate' || config.name === 'GUI Operate') {
            presetKey = 'gui-operate';
          }
          if (presetKey) {
            const preset = mcpConfigStore.createFromPreset(presetKey, true);
            if (preset?.args) {
              resolvedArgs = preset.args;
            }
          }
        }

        mcpServers[serverKey] = {
          type: 'stdio',
          command,
          args: resolvedArgs,
          env: serverEnv,
        };
        log(`[ClaudeAgentRunner] Added STDIO MCP server: ${serverKey}`);
        log(`[ClaudeAgentRunner]   Command: ${command} ${resolvedArgs.join(' ')}`);
        log(`[ClaudeAgentRunner]   Tools will be named: mcp__${serverKey}__<toolName>`);
      } else if (config.type === 'sse') {
        mcpServers[serverKey] = {
          type: 'sse',
          url: config.url,
          headers: config.headers || {},
        };
        log(`[ClaudeAgentRunner] Added SSE MCP server: ${serverKey}`);
      }
    } catch (error) {
      logError('[ClaudeAgentRunner] Failed to prepare MCP server config, skipping server', {
        serverId: config.id,
        serverName: config.name,
        error: toErrorText(error),
      });
    }
  }

  ctx.setMcpServersCache({ fingerprint: mcpFingerprint, servers: { ...mcpServers } });
  logMcpServersSummary(mcpServers);
  return mcpServers;
}

export async function preparePiSessionRun({
  ctx,
  session,
  prompt,
  existingMessages,
  workingDir,
  sandboxPath,
  useSandboxIsolation,
  sandbox,
  runStartTime,
}: PreparePiSessionRunOptions): Promise<PreparedPiSessionRun> {
  const lastUserMessage =
    existingMessages.length > 0 ? existingMessages[existingMessages.length - 1] : null;

  logCtx('[ClaudeAgentRunner] Total messages:', existingMessages.length);
  const hasImages =
    lastUserMessage?.content.some((content) => (content as { type?: string }).type === 'image') ||
    false;
  if (hasImages) {
    log('[ClaudeAgentRunner] User message contains images');
  }

  logTiming('before pi-ai model resolution', runStartTime);
  const runtimeConfig = configStore.getAll();
  const modelString = ctx.getCurrentModelString(runtimeConfig.model);
  const configProtocol = resolvePiRouteProtocol(
    runtimeConfig.provider,
    runtimeConfig.customProtocol
  );
  const rawBaseUrl = runtimeConfig.baseUrl?.trim() || undefined;
  const effectiveBaseUrl =
    configProtocol === 'openai' && runtimeConfig.provider !== 'ollama'
      ? normalizeOpenAICompatibleBaseUrl(rawBaseUrl) || rawBaseUrl
      : rawBaseUrl;

  let usedSyntheticModel = false;
  let piModel =
    resolvePiRegistryModel(modelString, {
      configProvider: configProtocol,
      customBaseUrl: effectiveBaseUrl,
      rawProvider: runtimeConfig.provider,
      customProtocol: runtimeConfig.customProtocol,
    }) ??
    (() => {
      usedSyntheticModel = true;
      const synthetic = resolveSyntheticPiModelFallback({
        rawModel: runtimeConfig.model,
        resolvedModelString: modelString,
        rawProvider: runtimeConfig.provider,
        routeProtocol: configProtocol,
        baseUrl: effectiveBaseUrl,
      });
      return applyPiModelRuntimeOverrides(
        buildSyntheticPiModel(
          synthetic.modelId,
          synthetic.provider,
          configProtocol,
          effectiveBaseUrl,
          undefined,
          undefined,
          runtimeConfig.contextWindow,
          runtimeConfig.maxTokens
        ),
        {
          configProvider: configProtocol,
          customBaseUrl: effectiveBaseUrl,
          rawProvider: runtimeConfig.provider,
          customProtocol: runtimeConfig.customProtocol,
        }
      );
    })();

  if (usedSyntheticModel) {
    logCtxWarn(
      '[ClaudeAgentRunner] Model not in pi-ai registry, using synthetic model:',
      modelString,
      '→',
      piModel.api
    );
  }
  logCtx('[ClaudeAgentRunner] Resolved pi-ai model:', piModel.provider, piModel.id);

  const provider = runtimeConfig.provider || 'anthropic';
  if (provider === 'ollama' && !runtimeConfig.contextWindow) {
    const ollamaBaseUrl = piModel.baseUrl || runtimeConfig.baseUrl || 'http://localhost:11434/v1';
    const ollamaInfo = await fetchOllamaModelInfo({
      baseUrl: ollamaBaseUrl,
      model: piModel.id,
      apiKey: runtimeConfig.apiKey,
    });
    if (ollamaInfo.contextWindow) {
      log(
        '[ClaudeAgentRunner] Ollama /api/show reported contextWindow:',
        ollamaInfo.contextWindow,
        '(was:',
        piModel.contextWindow,
        ')'
      );
      piModel = { ...piModel, contextWindow: ollamaInfo.contextWindow };
    }
  }

  const modelContextWindow = piModel.contextWindow || 128000;
  const modelMaxTokens = piModel.maxTokens || 16384;
  ctx.renderer.dispatch({
    type: 'session.contextInfo',
    payload: {
      sessionId: session.id,
      contextWindow: modelContextWindow,
      maxTokens: modelMaxTokens,
    },
  });

  const authStorage = getSharedAuthStorage();
  const apiKey = runtimeConfig.apiKey?.trim();
  if (apiKey) {
    const piProvider =
      provider === 'custom' ? runtimeConfig.customProtocol || 'anthropic' : provider;
    authStorage.setRuntimeApiKey(piProvider, apiKey);
    if (piModel.provider !== piProvider) {
      authStorage.setRuntimeApiKey(piModel.provider, apiKey);
      log('[ClaudeAgentRunner] Set runtime API key for model provider:', piModel.provider);
    }
    log('[ClaudeAgentRunner] Set runtime API key for config provider:', piProvider);
  } else if (provider === 'ollama') {
    log(
      '[ClaudeAgentRunner] Ollama configured without explicit API key; relying on OpenAI-compatible placeholder/env auth path',
      safeStringify({
        provider,
        modelProvider: piModel.provider,
        modelId: piModel.id,
        baseUrl: piModel.baseUrl || runtimeConfig.baseUrl || '',
      })
    );
  } else {
    logWarn('[ClaudeAgentRunner] No API key configured for provider:', provider);
  }

  logCtx('[ClaudeAgentRunner] Model baseUrl:', piModel.baseUrl, 'api:', piModel.api);
  logTiming('after pi-ai model resolution', runStartTime);

  const imageCapable = true;
  const wslDistro = sandbox.isWSL ? sandbox.wslStatus?.distro : undefined;
  const effectiveCwd =
    useSandboxIsolation && sandboxPath && wslDistro
      ? wslUnixPathToWindowsUnc(wslDistro, sandboxPath)
      : useSandboxIsolation && sandboxPath
        ? sandboxPath
        : workingDir || process.cwd();

  ensureSkillsSetup(ctx);
  const userClaudeDir = ctx.skillsPaths.getAppClaudeDir();
  log('[ClaudeAgentRunner] App claude dir:', userClaudeDir);
  log('[ClaudeAgentRunner] User working directory:', workingDir);

  logTiming('before building conversation context', runStartTime);
  logCtx('[ClaudeAgentRunner] Using pi-ai native routing for:', piModel.provider, piModel.id);

  const enableThinking = configStore.get('enableThinking') ?? false;
  logCtx('[ClaudeAgentRunner] Enable thinking mode:', enableThinking);
  type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  const thinkingLevel: PiThinkingLevel = enableThinking ? 'medium' : 'off';
  const sessionRuntimeSignature = buildPiSessionRuntimeSignature({
    configProvider: runtimeConfig.provider,
    customProtocol: runtimeConfig.customProtocol,
    modelProvider: piModel.provider,
    modelApi: piModel.api,
    modelBaseUrl: piModel.baseUrl,
    effectiveCwd,
    apiKey,
  });
  const skillPaths = await ctx.skillsPaths.resolveSkillPaths(session.id);
  const skillsSignature = JSON.stringify(skillPaths);
  log('[ClaudeAgentRunner] Skill paths for pi ResourceLoader:', skillPaths);

  let cachedSession = ctx.piSessions.get(session.id);
  if (cachedSession && cachedSession.runtimeSignature !== sessionRuntimeSignature) {
    logCtx('[ClaudeAgentRunner] Runtime changed, recreating cached pi session:', session.id);
    try {
      cachedSession.session.dispose();
    } catch (error) {
      logWarn('[ClaudeAgentRunner] dispose error while recreating pi session:', error);
    }
    ctx.piSessions.delete(session.id);
    cachedSession = undefined;
  }
  if (cachedSession && cachedSession.skillsSignature !== skillsSignature) {
    logCtx('[ClaudeAgentRunner] Skills changed, recreating cached pi session:', session.id);
    try {
      cachedSession.session.dispose();
    } catch (error) {
      logWarn('[ClaudeAgentRunner] dispose error while recreating pi session for skills:', error);
    }
    ctx.piSessions.delete(session.id);
    cachedSession = undefined;
  }

  const extensionResult: BeforeSessionRunResult = ctx.extensionManager
    ? await ctx.extensionManager.beforeSessionRun({
        session,
        prompt,
        existingMessages,
        isColdStart: !cachedSession,
        contextBudget: {
          contextWindow: modelContextWindow,
          maxTokens: modelMaxTokens,
          currentInputTokens: getLastInputTokenCount(existingMessages),
        },
      })
    : { promptPrefix: undefined, customTools: [] };

  let contextualPrompt = prompt;
  if (!cachedSession) {
    contextualPrompt = buildColdStartContextualPrompt({
      prompt,
      existingMessages,
      provider,
      contextWindow: modelContextWindow,
    });
  } else {
    logCtx('[ClaudeAgentRunner] Reusing existing SDK session for:', session.id);
  }
  if (extensionResult.promptPrefix?.trim()) {
    contextualPrompt = `${extensionResult.promptPrefix.trim()}\n\n${contextualPrompt}`;
  }

  logTiming('before building MCP servers config', runStartTime);
  buildMcpServers(ctx, imageCapable);
  logTiming('after building MCP servers config', runStartTime);

  const coworkAppendPrompt = buildCoworkAppendPrompt(
    ctx,
    workingDir,
    sandboxPath,
    useSandboxIsolation
  );
  logTiming('before agent session creation', runStartTime);

  const mcpCustomTools = ctx.mcpManager ? buildMcpCustomTools(ctx.mcpManager) : [];
  const extensionCustomTools = extensionResult.customTools || [];
  if (mcpCustomTools.length > 0) {
    log(
      `[ClaudeAgentRunner] Registered ${mcpCustomTools.length} MCP tools as customTools:`,
      mcpCustomTools.map((tool) => tool.name).join(', ')
    );
  }
  if (extensionCustomTools.length > 0) {
    log(
      `[ClaudeAgentRunner] Registered ${extensionCustomTools.length} extension tools as customTools:`,
      extensionCustomTools.map((tool) => tool.name).join(', ')
    );
  }

  await enrichProcessPathForBuild();
  const useWslSandboxBash = Boolean(
    useSandboxIsolation && sandboxPath && sandbox.isWSL && sandbox.wslStatus?.distro
  );
  const bashOptions: BashToolOptions | undefined = useWslSandboxBash
    ? {
        operations: createWslSandboxBashOperations({
          distro: sandbox.wslStatus!.distro!,
          sandboxPath: sandboxPath!,
          virtualWorkspacePath: VIRTUAL_WORKSPACE_PATH,
        }),
      }
    : process.platform === 'win32'
      ? { operations: createWindowsBashOperations() }
      : undefined;
  if (useWslSandboxBash) {
    log(
      `[ClaudeAgentRunner] Using WSL sandbox bash (distro=${sandbox.wslStatus!.distro}, sandbox=${sandboxPath})`
    );
  }

  const bashDefinition = createBashToolDefinition(effectiveCwd, bashOptions);
  const withTimeout = wrapBashToolWithDefaultTimeout([bashDefinition as ToolDefinition]);
  const wrappedBashTools = wrapBashToolForSudo(
    withTimeout,
    session.id,
    effectiveCwd,
    ctx.requestSudoPassword
  );
  const wrappedBash = wrappedBashTools.find((tool) => tool.name === 'bash');
  const allCustomTools = [
    ...(wrappedBash ? [wrappedBash] : []),
    ...mcpCustomTools,
    ...extensionCustomTools,
  ];

  logCtx(`[ClaudeAgentRunner] Session reuse check: cached=${!!cachedSession}`);
  logCtx(`[ClaudeAgentRunner] Model=${piModel.id}, thinkingLevel=${thinkingLevel}`);
  log('[ClaudeAgentRunner] Built-in tools: read, bash, edit, write');
  log(
    `[ClaudeAgentRunner] Custom tools (${allCustomTools.length}): ${allCustomTools.map((tool) => tool.name).join(', ')}`
  );

  if (cachedSession) {
    const piSession = cachedSession.session;
    if (cachedSession.modelId !== piModel.id) {
      logCtx(
        '[ClaudeAgentRunner] Model changed, hot-swapping:',
        cachedSession.modelId,
        '→',
        piModel.id
      );
      await piSession.setModel(piModel);
      cachedSession.modelId = piModel.id;
      if (cachedSession.ollamaNumCtx) {
        cachedSession.ollamaNumCtx.value = piModel.contextWindow || 128000;
        log(
          '[ClaudeAgentRunner] Updated Ollama num_ctx on hot-swap:',
          cachedSession.ollamaNumCtx.value
        );
      }
    }
    if (cachedSession.thinkingLevel !== thinkingLevel) {
      logCtx(
        '[ClaudeAgentRunner] Thinking level changed, hot-swapping:',
        cachedSession.thinkingLevel,
        '→',
        thinkingLevel
      );
      cachedSession.session.setThinkingLevel(thinkingLevel);
      cachedSession.thinkingLevel = thinkingLevel;
    }

    logCtx('[ClaudeAgentRunner] Reusing cached pi session for:', session.id);
    logTiming('agent session reused', runStartTime);
    return {
      piSession,
      cachedSession,
      provider,
      runtimeConfig,
      usedSyntheticModel,
      piModel,
      contextualPrompt,
      modelContextWindow,
      modelMaxTokens,
      thinkingLevel,
      promptPrefix: extensionResult.promptPrefix,
      compactionEnabled: cachedSession.compactionEnabled ?? true,
    };
  }

  const { DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
  const resourceLoader = new DefaultResourceLoader({
    cwd: effectiveCwd,
    agentDir: getAgentDir(),
    additionalSkillPaths: skillPaths,
    appendSystemPrompt: coworkAppendPrompt,
  });
  await resourceLoader.reload();

  const modelRegistry = ModelRegistry.create(authStorage);
  const memoryPrefixTokenEstimate = estimateTokensFromText(extensionResult.promptPrefix || '');
  const compactionSettings = buildCompactionSettings(
    provider,
    modelContextWindow,
    modelMaxTokens,
    memoryPrefixTokenEstimate
  );
  if (!compactionSettings.enabled) {
    log('[ClaudeAgentRunner] Auto-compaction disabled (contextWindow:', modelContextWindow, ')');
  } else {
    log('[ClaudeAgentRunner] Compaction settings:', JSON.stringify(compactionSettings));
  }

  const { session: piSession } = await createAgentSession({
    model: piModel,
    thinkingLevel,
    authStorage,
    modelRegistry,
    customTools: allCustomTools,
    sessionManager: PiSessionManager.inMemory(),
    settingsManager: PiSettingsManager.inMemory({
      compaction: compactionSettings,
      retry: { enabled: true, maxRetries: 2 },
    }),
    resourceLoader,
    cwd: effectiveCwd,
  });

  installPermissionHook(piSession, session.id, ctx.requestPermission, (toolName) =>
    ctx.getToolDisplayName(toolName)
  );

  evictOldestPiSession(ctx.piSessions);
  ctx.piSessions.set(session.id, {
    session: piSession,
    modelId: piModel.id,
    thinkingLevel,
    runtimeSignature: sessionRuntimeSignature,
    skillsSignature,
    compactionEnabled: compactionSettings.enabled,
  });

  if (provider === 'ollama') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agent = piSession.agent as any;
    if (!('_onPayload' in agent)) {
      logWarn(
        '[ClaudeAgentRunner] SDK agent does not expose _onPayload — skipping Ollama num_ctx patch'
      );
    } else {
      const originalOnPayload = agent._onPayload as
        | ((
            payload: Record<string, unknown>,
            modelArg: unknown
          ) => Promise<Record<string, unknown>>)
        | undefined;
      const ollamaNumCtx = { value: piModel.contextWindow || 128000 };
      agent._onPayload = async (payload: Record<string, unknown>, modelArg: unknown) => {
        let result = originalOnPayload
          ? await originalOnPayload.call(agent, payload, modelArg)
          : payload;
        if (result === undefined) {
          result = payload;
        }
        return { ...result, num_ctx: ollamaNumCtx.value };
      };
      ctx.piSessions.get(session.id)!.ollamaNumCtx = ollamaNumCtx;
      log('[ClaudeAgentRunner] Ollama _onPayload wrapper installed, num_ctx:', ollamaNumCtx.value);
    }
  }

  logTiming('agent session created', runStartTime);
  return {
    piSession,
    provider,
    runtimeConfig,
    usedSyntheticModel,
    piModel,
    contextualPrompt,
    modelContextWindow,
    modelMaxTokens,
    thinkingLevel,
    promptPrefix: extensionResult.promptPrefix,
    compactionEnabled: compactionSettings.enabled,
  };
}
