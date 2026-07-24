/**
 * SDK contract — thinking-tool guard: reasoning is auto-disabled on tool-bearing
 * requests for the Qwen chat-template rail (vLLM / SGLang), and the extension is
 * scoped away from Ollama and non-Qwen models. See docs/qwen-local-reliability.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHarnessModelRuntime,
  createHarnessWorkspace,
  createSyntheticPiModel,
  type HarnessWorkspace,
} from './harness-helpers';
import { THINKING_TOOL_GUARD_EXTENSION_NAME } from '../../main/agent/thinking-tool-guard';

vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logCtx: vi.fn(),
  logCtxWarn: vi.fn(),
  logCtxError: vi.fn(),
  logTiming: vi.fn(),
}));

vi.mock('../../main/config/config-store', () => ({
  configStore: {
    get: (..._args: unknown[]) => undefined,
  },
}));

import { createPiSession } from '../../main/agent/agent-runner-pi-session';
import type { AgentRunnerRunContext } from '../../main/agent/agent-runner-run-context';

const guardPath = `<inline:${THINKING_TOOL_GUARD_EXTENSION_NAME}>`;

let workspace: HarnessWorkspace | undefined;

function makeMinimalCtx(): AgentRunnerRunContext {
  return {
    renderer: {} as AgentRunnerRunContext['renderer'],
    pathResolver: {} as AgentRunnerRunContext['pathResolver'],
    activeControllers: new Map(),
    piSessions: new Map(),
    skillsPaths: {} as AgentRunnerRunContext['skillsPaths'],
    getToolDisplayName: (name) => name,
    getCurrentModelString: () => 'qwen3.6-27b',
    getMcpServersCache: () => null,
    setMcpServersCache: () => undefined,
    isSkillsSetupDone: () => true,
    setSkillsSetupDone: () => undefined,
  };
}

async function buildSession(
  sessionId: string,
  model: ReturnType<typeof createSyntheticPiModel>
) {
  workspace = createHarnessWorkspace();
  const modelRuntime = await createHarnessModelRuntime();
  return createPiSession({
    ctx: makeMinimalCtx(),
    sessionId,
    provider: 'openai',
    piModel: model,
    thinkingLevel: 'high',
    modelRuntime,
    customTools: [],
    skillPaths: [],
    promptTemplatePaths: [],
    coworkAppendPrompt: [],
    effectiveCwd: workspace.cwd,
    sessionRuntimeSignature: '{"test":true}',
    skillsSignature: '',
    modelContextWindow: 131072,
    modelMaxTokens: 8192,
  });
}

beforeEach(() => {
  workspace = undefined;
});

afterEach(() => {
  workspace?.cleanup();
  workspace = undefined;
});

describe('sdk-contract thinking-tool guard', () => {
  it('registers for a Qwen vLLM session and disables thinking only when tools are present', async () => {
    const result = await buildSession(
      'sdk-contract-qwen-thinking-guard',
      createSyntheticPiModel({
        id: 'qwen3.6-27b',
        reasoning: true,
        baseUrl: 'http://127.0.0.1:8000/v1',
      })
    );

    const extensions = result.piSession.resourceLoader.getExtensions().extensions;
    expect(extensions.some((ext) => ext.path === guardPath)).toBe(true);
    expect(result.piSession.extensionRunner.hasHandlers('before_provider_request')).toBe(true);

    const withTools = (await result.piSession.extensionRunner.emitBeforeProviderRequest({
      model: 'qwen3.6-27b',
      tools: [{ type: 'function', function: { name: 'get_weather' } }],
      chat_template_kwargs: { enable_thinking: true, preserve_thinking: true },
    })) as Record<string, unknown>;
    expect(withTools.chat_template_kwargs).toEqual({
      enable_thinking: false,
      preserve_thinking: true,
    });

    const noTools = (await result.piSession.extensionRunner.emitBeforeProviderRequest({
      model: 'qwen3.6-27b',
      chat_template_kwargs: { enable_thinking: true },
    })) as Record<string, unknown>;
    expect(noTools.chat_template_kwargs).toEqual({ enable_thinking: true });

    result.piSession.dispose();
  });

  it('does not register for a non-Qwen vLLM session', async () => {
    const result = await buildSession(
      'sdk-contract-non-qwen',
      createSyntheticPiModel({ id: 'llama3.3-70b', baseUrl: 'http://127.0.0.1:8000/v1' })
    );
    const extensions = result.piSession.resourceLoader.getExtensions().extensions;
    expect(extensions.some((ext) => ext.path === guardPath)).toBe(false);
    result.piSession.dispose();
  });

  it('does not register on an Ollama endpoint (even for a Qwen model)', async () => {
    const result = await buildSession(
      'sdk-contract-qwen-ollama',
      createSyntheticPiModel({
        id: 'qwen3.6-27b',
        reasoning: true,
        baseUrl: 'http://127.0.0.1:11434/v1',
      })
    );
    const extensions = result.piSession.resourceLoader.getExtensions().extensions;
    expect(extensions.some((ext) => ext.path === guardPath)).toBe(false);
    result.piSession.dispose();
  });
});
