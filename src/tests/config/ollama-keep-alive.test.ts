import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OLLAMA_KEEP_ALIVE,
  normalizeOllamaKeepAlive,
  toOllamaKeepAlivePayload,
} from '../../shared/ollama-keep-alive';
import {
  resetOllamaWarmupInflight,
  warmUpOllamaModel,
} from '../../main/config/ollama-api';

describe('ollama keep_alive mapping', () => {
  it('defaults missing or invalid values to 30m (soft migration)', () => {
    expect(normalizeOllamaKeepAlive(undefined)).toBe(DEFAULT_OLLAMA_KEEP_ALIVE);
    expect(normalizeOllamaKeepAlive('')).toBe('30m');
    expect(normalizeOllamaKeepAlive('nope')).toBe('30m');
    expect(normalizeOllamaKeepAlive(' 30m ')).toBe('30m');
    expect(normalizeOllamaKeepAlive('1h')).toBe('1h');
    expect(normalizeOllamaKeepAlive('-1')).toBe('-1');
    expect(normalizeOllamaKeepAlive(120)).toBe('120');
  });

  it('maps unit strings and bare seconds to the keep_alive payload', () => {
    expect(toOllamaKeepAlivePayload('30m')).toBe('30m');
    expect(toOllamaKeepAlivePayload('1h')).toBe('1h');
    expect(toOllamaKeepAlivePayload('45s')).toBe('45s');
    expect(toOllamaKeepAlivePayload('-1')).toBe(-1);
    expect(toOllamaKeepAlivePayload('1800')).toBe(1800);
    expect(toOllamaKeepAlivePayload('invalid')).toBe('30m');
  });
});

describe('ollama warm-up', () => {
  afterEach(() => {
    resetOllamaWarmupInflight();
    vi.restoreAllMocks();
  });

  it('does not propagate network failures', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));

    await expect(
      warmUpOllamaModel({
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen3.5:0.8b',
        keepAlive: '30m',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 50,
      })
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/api/generate');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'qwen3.5:0.8b',
      prompt: '',
      stream: false,
      keep_alive: '30m',
    });
  });

  it('sends numeric keep_alive seconds when configured as bare integer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });

    await warmUpOllamaModel({
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'llama3.2',
      keepAlive: '600',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1].body)) as Record<string, unknown>;
    expect(body.keep_alive).toBe(600);
  });
});
