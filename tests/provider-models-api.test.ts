import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchRemoteModelContextWindow,
  listProviderModels,
  resetRemoteModelContextWindowCacheForTests,
} from '../src/main/config/provider-models-api';
import { resetOllamaModelIndexCache } from '../src/main/config/ollama-api';

describe('provider models api', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetOllamaModelIndexCache();
    resetRemoteModelContextWindowCacheForTests();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('lists remote openai-compatible models from the models endpoint', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'gpt-5.4', object: 'model' },
            { id: 'o4-mini', object: 'model' },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const result = await listProviderModels({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
    });

    expect(result).toEqual([
      { id: 'gpt-5.4', name: 'gpt-5.4' },
      { id: 'o4-mini', name: 'o4-mini' },
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
        }),
      })
    );
  });

  it('returns an empty list when remote openai models endpoint is unsupported', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response('Not Found', {
        status: 404,
      })
    );

    const result = await listProviderModels({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://dashscope.example/v1',
    });

    expect(result).toEqual([]);
  });

  it('lists anthropic-compatible models from the models endpoint', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
            { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const result = await listProviderModels({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com',
    });

    expect(result).toEqual([
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-test',
        }),
      })
    );
  });

  it('captures the serving context window reported by vLLM-style endpoints', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'qwen3.6-27b', object: 'model', max_model_len: 131072 },
            { id: 'other-model', object: 'model', context_length: 32768 },
            { id: 'no-context-model', object: 'model' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await listProviderModels({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://vllm.lan:8000/v1',
    });

    expect(result).toEqual([
      { id: 'no-context-model', name: 'no-context-model' },
      { id: 'other-model', name: 'other-model', contextWindow: 32768 },
      { id: 'qwen3.6-27b', name: 'qwen3.6-27b', contextWindow: 131072 },
    ]);
  });

  it('fetches the remote context window for a specific model and caches it', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'qwen3.6-27b', object: 'model', max_model_len: 131072 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const first = await fetchRemoteModelContextWindow({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://vllm.lan:8000/v1',
      model: 'qwen3.6-27b',
    });
    const second = await fetchRemoteModelContextWindow({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://vllm.lan:8000/v1',
      model: 'qwen3.6-27b',
    });

    expect(first).toBe(131072);
    expect(second).toBe(131072);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns undefined and caches when the endpoint reports no context window', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ object: 'list', data: [{ id: 'qwen3.6-27b', object: 'model' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const first = await fetchRemoteModelContextWindow({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://vllm.lan:8000/v1',
      model: 'qwen3.6-27b',
    });
    const second = await fetchRemoteModelContextWindow({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://vllm.lan:8000/v1',
      model: 'qwen3.6-27b',
    });

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('propagates probe failures without caching them', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('network down'));

    await expect(
      fetchRemoteModelContextWindow({
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://vllm.lan:8000/v1',
        model: 'qwen3.6-27b',
      })
    ).rejects.toThrow('network down');

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'qwen3.6-27b', object: 'model', max_model_len: 131072 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      fetchRemoteModelContextWindow({
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://vllm.lan:8000/v1',
        model: 'qwen3.6-27b',
      })
    ).resolves.toBe(131072);
  });

  it('delegates loopback openai discovery to the ollama models endpoint', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'qwen3.5:0.8b', object: 'model' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const result = await listProviderModels({
      provider: 'openai',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
    });

    expect(result).toEqual([{ id: 'qwen3.5:0.8b', name: 'qwen3.5:0.8b' }]);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:11434/v1/models',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
