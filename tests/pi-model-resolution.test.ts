import { describe, expect, it } from 'vitest';
import {
  applyPiModelRuntimeOverrides,
  buildPiModelLookupCandidates,
  buildSyntheticPiModel,
  inferPiApi,
  resolvePiModelString,
  resolvePiRouteProtocol,
  resolveSyntheticPiModelFallback,
} from '../src/main/agent/pi-model-resolution';

describe('pi model resolution helpers', () => {
  it('skips invalid custom raw provider lookups and deduplicates candidates', () => {
    const candidates = buildPiModelLookupCandidates('openai/qwen3.5:0.8b', {
      configProvider: 'openai',
      rawProvider: 'openai',
    });

    expect(candidates).toEqual([
      { provider: 'openai', model: 'qwen3.5:0.8b' },
      { provider: 'anthropic', model: 'qwen3.5:0.8b' },
    ]);
  });

  it('builds provider-prefixed model ids from config-like input', () => {
    expect(
      resolvePiModelString({ provider: 'openai', customProtocol: 'openai', model: 'qwen3.5:0.8b' })
    ).toBe('openai/qwen3.5:0.8b');
    expect(
      resolvePiModelString({
        provider: 'anthropic',
        customProtocol: 'anthropic',
        model: 'anthropic/claude-sonnet-4-6',
      })
    ).toBe('anthropic/claude-sonnet-4-6');
  });

  it('routes providers through the openai-compatible or anthropic protocol', () => {
    expect(resolvePiRouteProtocol('openai', 'openai')).toBe('openai');
    expect(resolvePiRouteProtocol('anthropic', 'anthropic')).toBe('anthropic');
    expect(resolvePiRouteProtocol('openai', 'anthropic')).toBe('openai');
  });

  it('builds synthetic models with protocol-specific api defaults', () => {
    expect(inferPiApi('anthropic')).toBe('anthropic-messages');
    expect(inferPiApi('unknown')).toBe('openai-completions');

    const model = buildSyntheticPiModel('grok-code-fast-1', 'xai', 'openai', 'https://api.x.ai/v1');
    expect(model.id).toBe('grok-code-fast-1');
    expect(model.provider).toBe('xai');
    expect(model.api).toBe('openai-completions');
    expect(model.baseUrl).toBe('https://api.x.ai/v1');
  });

  it('strips helper-added provider prefixes for local openai fallbacks', () => {
    const fallback = resolveSyntheticPiModelFallback({
      rawModel: 'qwen3.5:0.8b',
      resolvedModelString: 'openai/qwen3.5:0.8b',
      rawProvider: 'openai',
      routeProtocol: 'openai',
      baseUrl: 'http://localhost:11434/v1',
    });

    expect(fallback).toEqual({
      provider: 'openai',
      modelId: 'qwen3.5:0.8b',
    });
  });

  it('maps ollama synthetic fallbacks onto the openai provider', () => {
    const fallback = resolveSyntheticPiModelFallback({
      rawModel: 'qwen3.5:0.8b',
      resolvedModelString: 'qwen3.5:0.8b',
      rawProvider: 'openai',
      routeProtocol: 'openai',
      baseUrl: 'http://localhost:11434/v1',
    });

    expect(fallback).toEqual({
      provider: 'openai',
      modelId: 'qwen3.5:0.8b',
    });
  });

  it('downgrades openai responses api to completions for custom endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'qwen3.5:0.8b',
        name: 'qwen3.5:0.8b',
        api: 'openai-responses',
        provider: 'openai',
        baseUrl: 'http://localhost:11434/v1',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'openai',
        rawProvider: 'openai',
        customBaseUrl: 'http://127.0.0.1:8000/v1',
      }
    );

    expect(model.baseUrl).toBe('http://127.0.0.1:8000/v1');
    expect(model.api).toBe('openai-completions');
  });

  it('disables developer role for third-party openai-compatible endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'kimi-k2.5',
        name: 'kimi-k2.5',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'openai',
        rawProvider: 'openai',
        customBaseUrl: 'https://api.moonshot.cn/v1',
      }
    );

    expect(model.baseUrl).toBe('https://api.moonshot.cn/v1');
    expect(model.compat?.supportsDeveloperRole).toBe(false);
  });

  it('auto-detects reasoning models by model id pattern', () => {
    const thinking = buildSyntheticPiModel(
      'kimi-k2-thinking',
      'moonshot',
      'openai',
      'https://api.moonshot.cn/v1'
    );
    expect(thinking.reasoning).toBe(true);

    const kimiK2 = buildSyntheticPiModel(
      'kimi-k2.5',
      'moonshot',
      'openai',
      'https://api.moonshot.cn/v1'
    );
    expect(kimiK2.reasoning).toBe(true);

    const deepseekR1 = buildSyntheticPiModel(
      'deepseek-r1-distill',
      'deepseek',
      'openai',
      'https://api.deepseek.com/v1'
    );
    expect(deepseekR1.reasoning).toBe(true);

    const deepseekV4 = buildSyntheticPiModel(
      'deepseek-v4-pro',
      'deepseek',
      'openai',
      'https://api.deepseek.com/v1'
    );
    expect(deepseekV4.reasoning).toBe(true);

    const qwen35 = buildSyntheticPiModel(
      'qwen3.5:0.8b',
      'openai',
      'openai',
      'http://localhost:11434/v1'
    );
    expect(qwen35.reasoning).toBe(true);

    const deepseekV4Pro = buildSyntheticPiModel(
      'deepseek-v4-pro',
      'deepseek',
      'openai',
      'https://api.deepseek.com/v1'
    );
    expect(deepseekV4Pro.reasoning).toBe(true);

    const qwen3 = buildSyntheticPiModel(
      'qwen3:8b',
      'openai',
      'openai',
      'http://localhost:11434/v1'
    );
    expect(qwen3.reasoning).toBe(true);

    const reasoner = buildSyntheticPiModel('o3-reasoner', 'openai', 'openai');
    expect(reasoner.reasoning).toBe(true);

    // Non-reasoning models should default to false
    const llama = buildSyntheticPiModel('llama3.2', 'meta', 'openai');
    expect(llama.reasoning).toBe(false);
  });

  it('allows explicit reasoning override in buildSyntheticPiModel', () => {
    // Force reasoning=true on a model that wouldn't auto-detect
    const forced = buildSyntheticPiModel('custom-model', 'custom', 'openai', '', undefined, true);
    expect(forced.reasoning).toBe(true);

    // Force reasoning=false on a model that would auto-detect
    const suppressed = buildSyntheticPiModel(
      'kimi-k2.5',
      'moonshot',
      'openai',
      '',
      undefined,
      false
    );
    expect(suppressed.reasoning).toBe(false);
  });

  it('does not false-positive on models with thinking as a substring', () => {
    // "critical-thinking-v2" should NOT match — \bthinking\b requires word boundary,
    // but here "thinking" IS a whole word between hyphens, so it WILL match.
    // This is intentional — hyphens are not \w so \b fires.
    const critical = buildSyntheticPiModel('critical-thinking-v2', 'custom', 'openai');
    expect(critical.reasoning).toBe(true);

    // But a model like "rethinkingai" should NOT match — no word boundary around "thinking"
    const rethinking = buildSyntheticPiModel('rethinkingai', 'custom', 'openai');
    expect(rethinking.reasoning).toBe(false);
  });

  it('disables developer role for ollama with custom endpoint', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'qwen3:8b',
        name: 'qwen3:8b',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: '',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 40960,
        maxTokens: 8192,
      },
      {
        configProvider: 'ollama',
        rawProvider: 'openai',
        customBaseUrl: 'http://localhost:11434/v1',
      }
    );

    expect(model.baseUrl).toBe('http://localhost:11434/v1');
    expect(model.compat?.supportsDeveloperRole).toBe(false);
  });

  it('maps ollama thinking off to reasoning_effort none for reasoning models', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'qwen3.5:0.8b',
        name: 'qwen3.5:0.8b',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: 'http://localhost:11434/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 258048,
        maxTokens: 32768,
      },
      {
        configProvider: 'openai',
        rawProvider: 'openai',
        customBaseUrl: 'http://localhost:11434/v1',
      }
    );

    expect(model.compat?.supportsReasoningEffort).toBe(true);
    expect((model.compat?.reasoningEffortMap as Record<string, string> | undefined)?.off).toBe(
      'none'
    );
  });

  it('disables supportsStore alongside developer role for non-standard endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'kimi-k2.5',
        name: 'kimi-k2.5',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'openai',
        rawProvider: 'openai',
        customBaseUrl: 'https://api.moonshot.cn/v1',
      }
    );

    expect(model.compat?.supportsDeveloperRole).toBe(false);
    expect(model.compat?.supportsStore).toBe(false);
  });

  it('preserves existing compat fields when disabling developer role', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'custom-model',
        name: 'custom-model',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: '',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        compat: { supportsStreaming: true } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      {
        configProvider: 'custom',
        rawProvider: 'openai',
        customBaseUrl: 'https://my-relay.example.com/v1',
      }
    );

    expect(model.compat?.supportsDeveloperRole).toBe(false);
    expect(model.compat?.supportsStore).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((model.compat as any)?.supportsStreaming).toBe(true);
  });

  it('sets requiresThinkingInContent for DeepSeek V4 models on custom endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'deepseek-v4-pro',
        name: 'deepseek-v4-pro',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: 'https://my-relay.example.com/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'custom',
        rawProvider: 'openai',
        customBaseUrl: 'https://my-relay.example.com/v1',
      }
    );

    expect(model.compat?.requiresThinkingInContent).toBe(true);
  });

  it('sets requiresThinkingInContent for provider-prefixed DeepSeek V4 model ids', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'deepseek/deepseek-v4-flash',
        name: 'deepseek/deepseek-v4-flash',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: 'http://127.0.0.1:8000/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'openai',
        rawProvider: 'openai',
        customBaseUrl: 'http://127.0.0.1:8000/v1',
      }
    );

    expect(model.compat?.requiresThinkingInContent).toBe(true);
  });

  it('does not set requiresThinkingInContent for non-V4 DeepSeek models on custom endpoints', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'deepseek-reasoner',
        name: 'deepseek-reasoner',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: 'https://my-relay.example.com/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        configProvider: 'custom',
        rawProvider: 'openai',
        customBaseUrl: 'https://my-relay.example.com/v1',
      }
    );

    expect(model.compat?.requiresThinkingInContent).toBeUndefined();
  });
});
