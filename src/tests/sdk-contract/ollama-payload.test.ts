/**
 * SDK contract — Ollama keep_alive / num_ctx via the official
 * before_provider_request extension hook (replaces the dead private-agent payload wrapper).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHarnessModelRuntime,
  createHarnessWorkspace,
  createSyntheticPiModel,
  type HarnessWorkspace,
} from './harness-helpers';
import { OLLAMA_PAYLOAD_EXTENSION_NAME } from '../../main/agent/ollama-payload-extension';

const configGet = vi.hoisted(() => vi.fn((..._args: unknown[]) => '30m' as string));

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
    get: (key: string) => configGet(key),
  },
}));

import { createPiSession } from '../../main/agent/agent-runner-pi-session';
import type { AgentRunnerRunContext } from '../../main/agent/agent-runner-run-context';

let workspace: HarnessWorkspace | undefined;

function makeMinimalCtx(): AgentRunnerRunContext {
  return {
    renderer: {} as AgentRunnerRunContext['renderer'],
    pathResolver: {} as AgentRunnerRunContext['pathResolver'],
    activeControllers: new Map(),
    piSessions: new Map(),
    skillsPaths: {} as AgentRunnerRunContext['skillsPaths'],
    getToolDisplayName: (name) => name,
    getCurrentModelString: () => 'sdk-contract-model',
    getMcpServersCache: () => null,
    setMcpServersCache: () => undefined,
    isSkillsSetupDone: () => true,
    setSkillsSetupDone: () => undefined,
  };
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

beforeEach(() => {
  configGet.mockReset();
  configGet.mockReturnValue('30m');
});

afterEach(() => {
  workspace?.cleanup();
  workspace = undefined;
});

describe('sdk-contract ollama-payload extension', () => {
  it('registers the extension on an Ollama session and extends the payload', async () => {
    workspace = createHarnessWorkspace();
    const { cwd } = workspace;
    const modelRuntime = await createHarnessModelRuntime();
    const ctx = makeMinimalCtx();
    const piModel = createSyntheticPiModel({
      baseUrl: 'http://127.0.0.1:11434/v1',
      contextWindow: 8192,
    });

    const result = await createPiSession({
      ctx,
      sessionId: 'sdk-contract-ollama-payload',
      provider: 'openai',
      piModel,
      thinkingLevel: 'off',
      modelRuntime,
      customTools: [],
      skillPaths: [],
      promptTemplatePaths: [],
      coworkAppendPrompt: [],
      effectiveCwd: cwd,
      sessionRuntimeSignature: '{"test":true}',
      skillsSignature: '',
      modelContextWindow: 8192,
      modelMaxTokens: 1024,
    });

    const extensions = result.piSession.resourceLoader.getExtensions().extensions;
    const ollamaExt = extensions.find(
      (ext) => ext.path === `<inline:${OLLAMA_PAYLOAD_EXTENSION_NAME}>`
    );
    expect(ollamaExt).toBeDefined();
    expect(ollamaExt?.hidden).toBe(true);
    expect(result.piSession.extensionRunner.hasHandlers('before_provider_request')).toBe(true);

    const extended = (await result.piSession.extensionRunner.emitBeforeProviderRequest({
      model: 'sdk-contract-model',
      stream: true,
      custom_flag: 'keep-me',
    })) as Record<string, unknown>;

    expect(extended).toEqual({
      model: 'sdk-contract-model',
      stream: true,
      custom_flag: 'keep-me',
      num_ctx: 8192,
      keep_alive: '30m',
    });
    expect(configGet).toHaveBeenCalledWith('ollamaKeepAlive');

    result.piSession.dispose();
  });

  it('reads keep_alive live between two provider requests', async () => {
    workspace = createHarnessWorkspace();
    const { cwd } = workspace;
    const modelRuntime = await createHarnessModelRuntime();
    const ctx = makeMinimalCtx();
    const piModel = createSyntheticPiModel({
      baseUrl: 'http://127.0.0.1:11434/v1',
    });

    const result = await createPiSession({
      ctx,
      sessionId: 'sdk-contract-ollama-keepalive-live',
      provider: 'ollama',
      piModel,
      thinkingLevel: 'off',
      modelRuntime,
      customTools: [],
      skillPaths: [],
      promptTemplatePaths: [],
      coworkAppendPrompt: [],
      effectiveCwd: cwd,
      sessionRuntimeSignature: '{"test":true}',
      skillsSignature: '',
      modelContextWindow: 8192,
      modelMaxTokens: 1024,
    });

    const first = (await result.piSession.extensionRunner.emitBeforeProviderRequest({
      n: 1,
    })) as Record<string, unknown>;
    expect(first.keep_alive).toBe('30m');

    configGet.mockReturnValue('1h');
    const second = (await result.piSession.extensionRunner.emitBeforeProviderRequest({
      n: 2,
    })) as Record<string, unknown>;
    expect(second.keep_alive).toBe('1h');
    expect(second.n).toBe(2);

    result.piSession.dispose();
  });

  it('does not register the extension on a non-Ollama session', async () => {
    workspace = createHarnessWorkspace();
    const { cwd } = workspace;
    const modelRuntime = await createHarnessModelRuntime();
    const ctx = makeMinimalCtx();
    const piModel = createSyntheticPiModel({
      baseUrl: 'http://127.0.0.1:8000/v1',
    });

    const result = await createPiSession({
      ctx,
      sessionId: 'sdk-contract-non-ollama',
      provider: 'openai',
      piModel,
      thinkingLevel: 'off',
      modelRuntime,
      customTools: [],
      skillPaths: [],
      promptTemplatePaths: [],
      coworkAppendPrompt: [],
      effectiveCwd: cwd,
      sessionRuntimeSignature: '{"test":true}',
      skillsSignature: '',
      modelContextWindow: 8192,
      modelMaxTokens: 1024,
    });

    const extensions = result.piSession.resourceLoader.getExtensions().extensions;
    expect(
      extensions.some((ext) => ext.path === `<inline:${OLLAMA_PAYLOAD_EXTENSION_NAME}>`)
    ).toBe(false);
    expect(result.piSession.extensionRunner.hasHandlers('before_provider_request')).toBe(false);

    const unchanged = await result.piSession.extensionRunner.emitBeforeProviderRequest({
      model: 'x',
    });
    expect(unchanged).toEqual({ model: 'x' });

    result.piSession.dispose();
  });

  it('has no remaining private-agent payload wrapper access in app sources', () => {
    // Wiring grep (like chat-folders-wiring): production code under src/, not tests.
    const marker = '_' + 'onPayload';
    const roots = ['main', 'renderer', 'shared', 'preload'].map((part) =>
      join(process.cwd(), 'src', part)
    );
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of listSourceFiles(root)) {
        const text = readFileSync(file, 'utf8');
        if (text.includes(marker)) {
          offenders.push(file.replace(`${process.cwd()}/`, ''));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
