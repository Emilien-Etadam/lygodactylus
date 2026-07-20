import {
  createBashToolDefinition,
  type AgentSession as PiAgentSession,
  type BashToolOptions,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { Message, Session } from '../../renderer/types';
import { configStore } from '../config/config-store';
import {
  isLoopbackOpenAIEndpoint,
  isOfficialOpenAIBaseUrl,
  normalizeOpenAICompatibleBaseUrl,
} from '../config/auth-utils';
import { fetchOllamaModelInfo } from '../config/ollama-api';
import { scheduleWarmUpFromAppConfig } from '../config/ollama-warmup-scheduler';
import { fetchRemoteModelContextWindow } from '../config/provider-models-api';
import { detectCommonProviderSetup } from '../../shared/api-provider-guidance';
import type { BeforeSessionRunResult } from '../extensions/agent-runtime-extension';
import type { SandboxAdapter } from '../sandbox/sandbox-adapter';
import { wslUnixPathToWindowsUnc } from '../sandbox/sandbox-workspace-path';
import { log, logCtx, logCtxWarn, logTiming, logWarn } from '../utils/logger';
import { buildColdStartContextualPrompt } from './agent-runner-history';
import { buildMcpServers } from './agent-runner-mcp-servers';
import { buildMcpCustomTools, safeStringify } from './agent-runner-mcp-bridge';
import { enrichProcessPathForBuild } from './agent-runner-path-env';
import {
  type CachedPiSession,
  createPiSession,
  disposeCachedPiSession,
  reuseCachedPiSession,
  wrapBashToolForSudo,
  wrapBashToolWithDefaultTimeout,
} from './agent-runner-pi-session';
import { buildCoworkAppendPrompt } from './agent-runner-prompts';
import { buildNativeCustomTools } from './agent-runner-native-tools';
import { buildWebSearchCustomTools } from './agent-runner-web-search-tool';
import { createScheduleTools } from '../schedule/schedule-tools';
import { mainAppState } from '../main-app-state';
import { getWorkspacePathUnsupportedReason } from '../main-working-dir';
import {
  AgentRunnerRunContext,
  ensureSkillsSetup,
  VIRTUAL_WORKSPACE_PATH,
} from './agent-runner-run-context';
import { getLastInputTokenCount } from './context-budget';
import { resolveProjectRulesFile } from './project-rules-file';
import {
  applyPiModelRuntimeOverrides,
  buildSyntheticPiModel,
  resolvePiRegistryModel,
  resolvePiRouteProtocol,
  resolveSyntheticPiModelFallback,
} from './pi-model-resolution';
import {
  normalizePluginSlashPromptForExpansion,
} from '../../shared/slash-commands';
import { assertMainProcessAcceptsSlashPrompt } from './assert-main-slash-command';
import {
  filterToolsForSessionMode,
  getPlanModeExcludedBuiltinTools,
  normalizeSessionMode,
  PLAN_MODE_SYSTEM_PROMPT,
} from '../../shared/session-mode';
import { buildPiSessionRuntimeSignature } from './pi-session-runtime';
import { getSharedAuthStorage } from './shared-auth';
import { createWindowsBashOperations } from './windows-bash-operations';
import { createWslSandboxBashOperations } from './wsl-sandbox-bash-operations';
import { isQuickAskSessionTitle, QUICK_ASK_SYSTEM_PROMPT } from '../../shared/quick-ask';

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
  const lastUserMessage = existingMessages.at(-1) ?? null;
  logCtx('[AgentRunner] Total messages:', existingMessages.length);
  if (lastUserMessage?.content.some((content) => (content as { type?: string }).type === 'image')) {
    log('[AgentRunner] User message contains images');
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
    configProtocol === 'openai'
      ? isLoopbackOpenAIEndpoint({ provider: runtimeConfig.provider, baseUrl: rawBaseUrl })
        ? rawBaseUrl
        : normalizeOpenAICompatibleBaseUrl(rawBaseUrl) || rawBaseUrl
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
      '[AgentRunner] Model not in pi-ai registry, using synthetic model:',
      modelString,
      '→',
      piModel.api
    );
  }
  logCtx('[AgentRunner] Resolved pi-ai model:', piModel.provider, piModel.id);

  const provider = runtimeConfig.provider || 'anthropic';
  const effectiveModelBaseUrl = piModel.baseUrl || runtimeConfig.baseUrl || '';
  const isOllamaEndpoint = detectCommonProviderSetup(effectiveModelBaseUrl)?.id === 'ollama';
  // Pre-load the model in the background (keep_alive). Never blocks the UI.
  if (isOllamaEndpoint) {
    scheduleWarmUpFromAppConfig(runtimeConfig);
  }
  // The serving endpoint is the authority on the usable context window: local
  // deployments routinely cap it below the model family's nominal size
  // (vLLM --max-model-len, Ollama num_ctx). Trusting the hardcoded spec makes
  // the gauge and auto-compaction budgets wrong and the server rejects
  // requests long before compaction triggers. A manual contextWindow in API
  // settings always wins over detection.
  // Ollama /api/show also yields params/quant (cached); forwarded for UI stats.
  let modelParameterSize: string | undefined;
  let modelQuantization: string | undefined;
  if (provider === 'openai' && isOllamaEndpoint) {
    const ollamaInfo = await fetchOllamaModelInfo({
      baseUrl: effectiveModelBaseUrl || 'http://localhost:11434/v1',
      model: piModel.id,
      apiKey: runtimeConfig.apiKey,
    });
    modelParameterSize = ollamaInfo.parameterSize;
    modelQuantization = ollamaInfo.quantization;
    if (!runtimeConfig.contextWindow && ollamaInfo.contextWindow) {
      log(
        '[AgentRunner] Ollama /api/show reported contextWindow:',
        ollamaInfo.contextWindow,
        '(was:',
        piModel.contextWindow,
        ')'
      );
      piModel = { ...piModel, contextWindow: ollamaInfo.contextWindow };
    }
  } else if (
    provider === 'openai' &&
    !runtimeConfig.contextWindow &&
    !isOfficialOpenAIBaseUrl(effectiveModelBaseUrl)
  ) {
    try {
      const reportedContextWindow = await fetchRemoteModelContextWindow({
        baseUrl: effectiveModelBaseUrl,
        apiKey: runtimeConfig.apiKey,
        provider,
        customProtocol: runtimeConfig.customProtocol,
        model: piModel.id,
      });
      if (reportedContextWindow && reportedContextWindow !== piModel.contextWindow) {
        log(
          '[AgentRunner] Endpoint /models reported contextWindow:',
          reportedContextWindow,
          '(was:',
          piModel.contextWindow,
          ')'
        );
        piModel = { ...piModel, contextWindow: reportedContextWindow };
      }
    } catch (error) {
      logWarn('[AgentRunner] Context window probe failed (using defaults):', error);
    }
  }

  const modelContextWindow = piModel.contextWindow || 128000;
  const modelMaxTokens = piModel.maxTokens || 16384;

  const authStorage = getSharedAuthStorage();
  const apiKey = runtimeConfig.apiKey?.trim();
  if (apiKey) {
    authStorage.setRuntimeApiKey(provider, apiKey);
    if (piModel.provider !== provider) {
      authStorage.setRuntimeApiKey(piModel.provider, apiKey);
      log('[AgentRunner] Set runtime API key for model provider:', piModel.provider);
    }
    log('[AgentRunner] Set runtime API key for config provider:', provider);
  } else if (
    provider === 'openai' &&
    isLoopbackOpenAIEndpoint({ provider, baseUrl: runtimeConfig.baseUrl })
  ) {
    log(
      '[AgentRunner] Ollama configured without explicit API key; relying on OpenAI-compatible placeholder/env auth path',
      safeStringify({
        provider,
        modelProvider: piModel.provider,
        modelId: piModel.id,
        baseUrl: piModel.baseUrl || runtimeConfig.baseUrl || '',
      })
    );
  } else {
    logWarn('[AgentRunner] No API key configured for provider:', provider);
  }

  logCtx('[AgentRunner] Model baseUrl:', piModel.baseUrl, 'api:', piModel.api);
  logTiming('after pi-ai model resolution', runStartTime);

  const imageCapable = true;
  const wslDistro = sandbox.isWSL ? sandbox.wslStatus?.distro : undefined;
  // Same cwd passed to DefaultResourceLoader / createAgentSession — ensures
  // SDK AGENTS.md discovery targets the chosen workspace (or its sandbox mount).
  const effectiveCwd =
    useSandboxIsolation && sandboxPath && wslDistro
      ? wslUnixPathToWindowsUnc(wslDistro, sandboxPath)
      : useSandboxIsolation && sandboxPath
        ? sandboxPath
        : workingDir || process.cwd();
  // Prefer the user-chosen workspace folder so AGENTS.md / .rules / CLAUDE.md
  // are found even when the effective tool cwd is a sandbox mount.
  const projectRules = resolveProjectRulesFile(workingDir || effectiveCwd);
  ctx.renderer.dispatch({
    type: 'session.contextInfo',
    payload: {
      sessionId: session.id,
      contextWindow: modelContextWindow,
      maxTokens: modelMaxTokens,
      ...(modelParameterSize ? { parameterSize: modelParameterSize } : {}),
      ...(modelQuantization ? { quantization: modelQuantization } : {}),
      projectRulesFile: projectRules?.fileName ?? null,
    },
  });

  await ensureSkillsSetup(ctx);
  log('[AgentRunner] Runtime skills dir:', ctx.skillsPaths.getRuntimeSkillsDir());
  log('[AgentRunner] User working directory:', workingDir);

  logTiming('before building conversation context', runStartTime);
  logCtx('[AgentRunner] Using pi-ai native routing for:', piModel.provider, piModel.id);
  const thinkingLevel: PreparedPiSessionRun['thinkingLevel'] =
    (configStore.get('enableThinking') ?? false) ? configStore.get('thinkingLevel') : 'off';
  logCtx('[AgentRunner] Enable thinking mode:', thinkingLevel);

  const sessionMode = normalizeSessionMode(session.mode);
  const sessionRuntimeSignature = buildPiSessionRuntimeSignature({
    configProvider: runtimeConfig.provider,
    customProtocol: runtimeConfig.customProtocol,
    modelProvider: piModel.provider,
    modelApi: piModel.api,
    modelBaseUrl: piModel.baseUrl,
    effectiveCwd,
    apiKey,
    sessionMode,
  });
  const pluginSlashCommands = ctx.skillsPaths.listPluginSlashCommands();
  assertMainProcessAcceptsSlashPrompt(prompt, pluginSlashCommands);
  const normalizedPrompt = normalizePluginSlashPromptForExpansion(prompt, pluginSlashCommands);

  const skillPaths = await ctx.skillsPaths.resolveSkillPaths(session.id);
  const promptTemplatePaths = await ctx.skillsPaths.resolvePluginPromptTemplatePaths();
  const skillsSignature = JSON.stringify({ skillPaths, promptTemplatePaths });
  log('[AgentRunner] Skill paths for pi ResourceLoader:', skillPaths);
  log('[AgentRunner] Prompt template paths for pi ResourceLoader:', promptTemplatePaths);

  let cachedSession = ctx.piSessions.get(session.id);
  const invalidateCachedSession = (reason: string, warningLabel: string) => {
    if (!cachedSession) {
      return;
    }
    logCtx(reason, session.id);
    try {
      disposeCachedPiSession(cachedSession);
    } catch (error) {
      logWarn(warningLabel, error);
    }
    ctx.piSessions.delete(session.id);
    cachedSession = undefined;
  };
  if (cachedSession?.runtimeSignature !== sessionRuntimeSignature) {
    invalidateCachedSession(
      '[AgentRunner] Runtime changed, recreating cached pi session:',
      '[AgentRunner] dispose error while recreating pi session:'
    );
  }
  if (cachedSession?.skillsSignature !== skillsSignature) {
    invalidateCachedSession(
      '[AgentRunner] Skills changed, recreating cached pi session:',
      '[AgentRunner] dispose error while recreating pi session for skills:'
    );
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

  let contextualPrompt = cachedSession
    ? normalizedPrompt
    : buildColdStartContextualPrompt({
        prompt: normalizedPrompt,
        existingMessages,
        provider,
        contextWindow: modelContextWindow,
      });
  if (cachedSession) {
    logCtx('[AgentRunner] Reusing existing SDK session for:', session.id);
  }
  // Memory (and other extension prefixes) vary per turn: keep them on the USER
  // prompt, AFTER the stable system prefix, so llama.cpp cache_prompt / vLLM
  // prefix caching can reuse the system prefix across turns.
  if (extensionResult.promptPrefix?.trim()) {
    contextualPrompt = `${extensionResult.promptPrefix.trim()}\n\n${contextualPrompt}`;
  }

  logTiming('before building MCP servers config', runStartTime);
  buildMcpServers(ctx, imageCapable);
  logTiming('after building MCP servers config', runStartTime);

  // Tool gating uses session.mode via session-mode.ts (single point). Quick Ask
  // sessions are created with mode='plan'; we only customize the system prompt:
  // replace PLAN_MODE_SYSTEM_PROMPT with QUICK_ASK_SYSTEM_PROMPT so the model
  // answers concisely instead of producing a numbered action plan.
  let coworkAppendPrompt = buildCoworkAppendPrompt(
    ctx,
    workingDir,
    sandboxPath,
    useSandboxIsolation,
    configStore.get('sandboxLanNetworkEnabled') === true,
    sessionMode
  );
  if (isQuickAskSessionTitle(session.title)) {
    coworkAppendPrompt = [
      ...coworkAppendPrompt.filter((section) => section !== PLAN_MODE_SYSTEM_PROMPT),
      QUICK_ASK_SYSTEM_PROMPT,
    ];
  }
  const mcpCustomTools = ctx.mcpManager ? buildMcpCustomTools(ctx.mcpManager) : [];
  const webSearchCustomTools = buildWebSearchCustomTools();
  const nativeCustomTools = buildNativeCustomTools({
    cwd: effectiveCwd,
    sessionId: session.id,
    requestUserQuestion: ctx.requestUserQuestion,
  });
  const scheduleCustomTools = createScheduleTools({
    getManager: () => mainAppState.scheduledTaskManager,
    defaultCwd: workingDir || process.cwd(),
    getCwdUnsupportedReason: getWorkspacePathUnsupportedReason,
  });
  const extensionCustomTools = extensionResult.customTools || [];
  if (mcpCustomTools.length > 0) {
    log(
      `[AgentRunner] Registered ${mcpCustomTools.length} MCP tools as customTools:`,
      mcpCustomTools.map((tool) => tool.name).join(', ')
    );
  }
  if (webSearchCustomTools.length > 0) {
    log(
      `[AgentRunner] Registered ${webSearchCustomTools.length} web search tools as customTools:`,
      webSearchCustomTools.map((tool) => tool.name).join(', ')
    );
  }
  if (nativeCustomTools.length > 0) {
    log(
      `[AgentRunner] Registered ${nativeCustomTools.length} native tools as customTools:`,
      nativeCustomTools.map((tool) => tool.name).join(', ')
    );
  }
  if (scheduleCustomTools.length > 0) {
    log(
      `[AgentRunner] Registered ${scheduleCustomTools.length} schedule tools as customTools:`,
      scheduleCustomTools.map((tool) => tool.name).join(', ')
    );
  }
  if (extensionCustomTools.length > 0) {
    log(
      `[AgentRunner] Registered ${extensionCustomTools.length} extension tools as customTools:`,
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
      `[AgentRunner] Using WSL sandbox bash (distro=${sandbox.wslStatus!.distro}, sandbox=${sandboxPath})`
    );
  }

  const bashDefinition = createBashToolDefinition(effectiveCwd, bashOptions);
  const wrappedBash = wrapBashToolForSudo(
    wrapBashToolWithDefaultTimeout([bashDefinition as ToolDefinition]),
    session.id,
    effectiveCwd,
    ctx.requestSudoPassword
  ).find((tool) => tool.name === 'bash');
  // Assemble the full toolset, then filter once for plan mode (single gating point).
  const assembledCustomTools = [
    ...(wrappedBash ? [wrappedBash] : []),
    ...nativeCustomTools,
    ...scheduleCustomTools,
    ...webSearchCustomTools,
    ...mcpCustomTools,
    ...extensionCustomTools,
  ];
  const allCustomTools = filterToolsForSessionMode(assembledCustomTools, sessionMode);
  const excludeBuiltinTools = getPlanModeExcludedBuiltinTools(sessionMode);

  logCtx(`[AgentRunner] Session reuse check: cached=${!!cachedSession}`);
  logCtx(`[AgentRunner] Model=${piModel.id}, thinkingLevel=${thinkingLevel}`);
  logCtx(`[AgentRunner] Session mode: ${sessionMode}`);
  log(
    sessionMode === 'plan'
      ? '[AgentRunner] Built-in tools (plan): read'
      : '[AgentRunner] Built-in tools: read, bash, edit, write'
  );
  log(
    '[AgentRunner] Native tools: glob, grep, web_fetch, http_request, todo_write, ask_user_question (+ aliases)'
  );
  log(
    `[AgentRunner] Custom tools (${allCustomTools.length}): ${allCustomTools.map((tool) => tool.name).join(', ')}`
  );
  logTiming('before agent session creation', runStartTime);

  const buildResult = (
    piSession: PiAgentSession,
    compactionEnabled: boolean,
    reusedSession?: CachedPiSession
  ): PreparedPiSessionRun => ({
    piSession,
    cachedSession: reusedSession,
    provider,
    runtimeConfig,
    usedSyntheticModel,
    piModel,
    contextualPrompt,
    modelContextWindow,
    modelMaxTokens,
    thinkingLevel,
    promptPrefix: extensionResult.promptPrefix,
    compactionEnabled,
  });

  const reusedSession = await reuseCachedPiSession({
    cachedSession,
    piModel,
    thinkingLevel,
    sessionId: session.id,
  });
  if (reusedSession) {
    logTiming('agent session reused', runStartTime);
    return buildResult(
      reusedSession.piSession,
      reusedSession.compactionEnabled,
      reusedSession.cachedSession
    );
  }

  const { piSession, compactionEnabled } = await createPiSession({
    ctx,
    sessionId: session.id,
    provider,
    piModel,
    thinkingLevel,
    authStorage,
    customTools: allCustomTools,
    excludeTools: excludeBuiltinTools,
    skillPaths,
    promptTemplatePaths,
    coworkAppendPrompt,
    effectiveCwd,
    sessionRuntimeSignature,
    skillsSignature,
    promptPrefix: extensionResult.promptPrefix,
    modelContextWindow,
    modelMaxTokens,
    projectRules,
  });

  logTiming('agent session created', runStartTime);
  return buildResult(piSession, compactionEnabled);
}
