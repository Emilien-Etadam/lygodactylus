import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runPiAiOneShotMock = vi.hoisted(() => vi.fn());
const chatCompletionsCreateMock = vi.hoisted(() => vi.fn());

vi.mock('../../main/agent/pi-ai-one-shot', () => ({
  runPiAiOneShot: runPiAiOneShotMock,
}));

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = {
      completions: {
        create: chatCompletionsCreateMock,
      },
    };

    constructor(_options: { apiKey: string; baseURL?: string; timeout?: number }) {}
  },
}));

import type { AppConfig } from '../../main/config/config-store';
import { DEFAULT_WEB_SEARCH_CONFIG } from '../../main/config/config-store';
import { MemoryLLMClient } from '../../main/memory/memory-llm-client';

function makeConfig(timeoutMs: number, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    provider: 'openai',
    customProtocol: 'openai',
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    model: 'test-model',
    activeProfileKey: 'openai',
    profiles: {},
    activeConfigSetId: 'default',
    configSets: [],
    claudeCodePath: '',
    defaultWorkdir: '',
    globalSkillsPath: '',
    enableDevLogs: false,
    theme: 'light',
    sandboxEnabled: false,
    sandboxLanNetworkEnabled: false,
    memoryEnabled: true,
    memoryRuntime: {
      llm: {
        inheritFromActive: true,
        apiKey: '',
        baseUrl: '',
        model: '',
        timeoutMs,
      },
      embedding: {
        inheritFromActive: true,
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
    enableThinking: false,
    thinkingLevel: 'medium',
    speechSynthesisEnabled: false,
    modelStatsEnabled: true,
    quickAskEnabled: false,
    quickAskShortcut: 'CommandOrControl+Shift+Space',
    isConfigured: true,
    constrainedOutput: 'auto',
    constrainedOutputCapability: null,
    ...overrides,
    ollamaKeepAlive: overrides.ollamaKeepAlive ?? '30m',
    checkpointsEnabled: overrides.checkpointsEnabled ?? true,
    workspaceTooling: overrides.workspaceTooling ?? {},
  };
}

describe('MemoryLLMClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runPiAiOneShotMock.mockReset();
    chatCompletionsCreateMock.mockReset();
    chatCompletionsCreateMock.mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
    });
    runPiAiOneShotMock.mockResolvedValue({ text: 'pi-ai response' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts one-shot completions with the configured memory LLM timeout', async () => {
    let signal: AbortSignal | undefined;
    runPiAiOneShotMock.mockImplementation((_prompt, _systemPrompt, _config, options) => {
      signal = options?.signal;
      return new Promise(() => undefined);
    });

    const client = new MemoryLLMClient(() => makeConfig(5000));
    const completion = client
      .complete({
        systemPrompt: 'memory system',
        userPrompt: 'memory user',
      })
      .then(
        () => null,
        (error: unknown) => error as Error
      );

    await vi.advanceTimersByTimeAsync(4999);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    const error = await completion;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Memory LLM request timed out after 5000ms');
  });

  it('uses OpenAI SDK JSON mode for openai provider when jsonMode is enabled', async () => {
    const client = new MemoryLLMClient(() => makeConfig(5000));
    const response = await client.complete({
      systemPrompt: 'memory system',
      userPrompt: 'memory user',
      temperature: 0,
      maxTokens: 16_000,
      jsonMode: true,
    });

    expect(chatCompletionsCreateMock).toHaveBeenCalledWith(
      {
        model: 'test-model',
        temperature: 0,
        max_tokens: 16_000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'memory system' },
          { role: 'user', content: 'memory user' },
        ],
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(runPiAiOneShotMock).not.toHaveBeenCalled();
    expect(response).toEqual({ text: '{"ok":true}' });
  });

  it('prefers pi-ai constrained schema when endpoint capability is cached', async () => {
    const client = new MemoryLLMClient(() =>
      makeConfig(5000, {
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen3.5:0.8b',
        constrainedOutput: 'auto',
        constrainedOutputCapability: {
          baseUrl: 'http://localhost:11434/v1',
          model: 'qwen3.5:0.8b',
          supported: true,
          field: 'ollama_format',
          probedAt: '2026-01-01T00:00:00.000Z',
        },
      })
    );

    const response = await client.complete({
      systemPrompt: 'memory system',
      userPrompt: 'memory user',
      jsonMode: true,
    });

    expect(chatCompletionsCreateMock).not.toHaveBeenCalled();
    expect(runPiAiOneShotMock).toHaveBeenCalledWith(
      'memory user',
      'memory system',
      expect.objectContaining({ model: 'qwen3.5:0.8b' }),
      expect.objectContaining({
        responseSchema: { type: 'object' },
        responseSchemaName: 'memory_json',
      })
    );
    expect(response).toEqual({ text: 'pi-ai response' });
  });

  it('uses pi-ai when jsonMode is not enabled', async () => {
    const client = new MemoryLLMClient(() => makeConfig(5000));
    const response = await client.complete({
      systemPrompt: 'memory system',
      userPrompt: 'memory user',
    });

    expect(chatCompletionsCreateMock).not.toHaveBeenCalled();
    expect(runPiAiOneShotMock).toHaveBeenCalled();
    expect(response).toEqual({ text: 'pi-ai response' });
  });

  it('uses pi-ai for non-openai providers even when jsonMode is enabled', async () => {
    const client = new MemoryLLMClient(() =>
      makeConfig(5000, {
        provider: 'anthropic',
        customProtocol: 'anthropic',
      })
    );
    const response = await client.complete({
      systemPrompt: 'memory system',
      userPrompt: 'memory user',
      jsonMode: true,
    });

    expect(chatCompletionsCreateMock).not.toHaveBeenCalled();
    expect(runPiAiOneShotMock).toHaveBeenCalled();
    expect(response).toEqual({ text: 'pi-ai response' });
  });

  it('falls back to pi-ai when OpenAI JSON mode completion fails', async () => {
    chatCompletionsCreateMock.mockRejectedValue(new Error('response_format not supported'));

    const client = new MemoryLLMClient(() => makeConfig(5000));
    const response = await client.complete({
      systemPrompt: 'memory system',
      userPrompt: 'memory user',
      jsonMode: true,
    });

    expect(chatCompletionsCreateMock).toHaveBeenCalled();
    expect(runPiAiOneShotMock).toHaveBeenCalled();
    expect(response).toEqual({ text: 'pi-ai response' });
  });

  it('skips embedding when inheriting a non-OpenAI inference endpoint', async () => {
    const client = new MemoryLLMClient(() => ({
      ...makeConfig(5000),
      baseUrl: 'http://192.168.1.50:8000/v1',
      memoryRuntime: {
        ...makeConfig(5000).memoryRuntime,
        useEmbedding: true,
      },
    }));

    await expect(client.embed('hello world')).resolves.toEqual([]);
  });
});
