import { describe, expect, it, vi } from 'vitest';
import {
  applyConstraintToPayload,
  buildConstraintPayloadPatch,
  constraintFieldForEndpointKind,
  isCapabilityCacheValid,
  isLikelyConstraintFieldError,
  parseProbeResponse,
  probeJsonSchemaCapability,
  resolveEndpointConstraintKind,
  shouldInvalidateCapabilityCache,
  stripConstraintFromPayload,
  withConstrainedOutputFallback,
} from '../../main/config/endpoint-capabilities';

describe('endpoint constraint field mapping', () => {
  it('maps endpoint kinds to the expected request field (table)', () => {
    const table: Array<{
      baseUrl: string;
      provider: 'openai' | 'anthropic';
      customProtocol?: 'openai' | 'anthropic';
      kind: ReturnType<typeof resolveEndpointConstraintKind>;
      field: ReturnType<typeof constraintFieldForEndpointKind>;
    }> = [
      {
        baseUrl: 'http://localhost:11434/v1',
        provider: 'openai',
        kind: 'ollama',
        field: 'ollama_format',
      },
      {
        baseUrl: 'http://127.0.0.1:8000/v1',
        provider: 'openai',
        kind: 'openai_compatible',
        field: 'openai_json_schema',
      },
      {
        baseUrl: 'http://localhost:8080/v1',
        provider: 'openai',
        kind: 'openai_compatible',
        field: 'openai_json_schema',
      },
      {
        baseUrl: 'http://192.168.1.10:1234/v1',
        provider: 'openai',
        kind: 'openai_compatible',
        field: 'openai_json_schema',
      },
      {
        baseUrl: 'http://localhost:8080',
        provider: 'anthropic',
        customProtocol: 'anthropic',
        kind: 'unsupported',
        field: null,
      },
    ];

    for (const row of table) {
      const kind = resolveEndpointConstraintKind({
        baseUrl: row.baseUrl,
        provider: row.provider,
        customProtocol: row.customProtocol,
      });
      expect(kind, row.baseUrl).toBe(row.kind);
      expect(constraintFieldForEndpointKind(kind), row.baseUrl).toBe(row.field);
    }
  });

  it('builds ollama format and openai json_schema payload patches', () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    expect(buildConstraintPayloadPatch('ollama_format', schema)).toEqual({ format: schema });
    expect(buildConstraintPayloadPatch('openai_json_schema', schema, 'probe')).toEqual({
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'probe', strict: true, schema },
      },
    });
  });
});

describe('parseProbeResponse', () => {
  it('accepts conforming OpenAI-style JSON content', () => {
    const result = parseProbeResponse({
      httpStatus: 200,
      bodyText: JSON.stringify({
        choices: [{ message: { content: '{"ok": true}' } }],
      }),
    });
    expect(result).toEqual({ conforming: true });
  });

  it('rejects non-conforming JSON content', () => {
    const result = parseProbeResponse({
      httpStatus: 200,
      bodyText: JSON.stringify({
        choices: [{ message: { content: '{"hello": "world"}' } }],
      }),
    });
    expect(result).toEqual({ conforming: false, reason: 'non_conforming' });
  });

  it('rejects HTTP 4xx as unsupported', () => {
    const result = parseProbeResponse({
      httpStatus: 400,
      bodyText: JSON.stringify({ error: { message: 'response_format not supported' } }),
    });
    expect(result).toEqual({ conforming: false, reason: 'http_error' });
  });

  it('rejects empty bodies', () => {
    expect(parseProbeResponse({ httpStatus: 200, bodyText: '   ' })).toEqual({
      conforming: false,
      reason: 'empty',
    });
  });

  it('accepts Ollama-native message.content envelopes', () => {
    const result = parseProbeResponse({
      httpStatus: 200,
      bodyText: JSON.stringify({ message: { content: '{"ok": false}' } }),
    });
    expect(result).toEqual({ conforming: true });
  });
});

describe('withConstrainedOutputFallback', () => {
  it('retries immediately without the constraint field on constraint errors', async () => {
    const calls: Array<'with' | 'without'> = [];
    const result = await withConstrainedOutputFallback({
      field: 'openai_json_schema',
      schema: { type: 'object' },
      run: async (onPayload) => {
        if (onPayload) {
          calls.push('with');
          const patched = onPayload({ model: 'm', messages: [] });
          expect(patched).toMatchObject({ response_format: { type: 'json_schema' } });
          throw new Error('400 response_format not supported');
        }
        calls.push('without');
        return 'ok-unconstrained';
      },
    });
    expect(result).toBe('ok-unconstrained');
    expect(calls).toEqual(['with', 'without']);
  });

  it('does not retry when the error is unrelated to the constraint field', async () => {
    await expect(
      withConstrainedOutputFallback({
        field: 'ollama_format',
        schema: { type: 'object' },
        run: async () => {
          throw new Error('ECONNREFUSED');
        },
        isConstraintError: isLikelyConstraintFieldError,
      })
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('strips constraint fields from payloads', () => {
    const withFormat = applyConstraintToPayload(
      { model: 'm', format: { type: 'object' } },
      'ollama_format',
      { type: 'object' }
    );
    expect(stripConstraintFromPayload(withFormat, 'ollama_format')).not.toHaveProperty('format');
  });
});

describe('capability cache invalidation', () => {
  it('invalidates when the URL changes', () => {
    const cache = {
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen',
      supported: true,
      field: 'ollama_format' as const,
      probedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(isCapabilityCacheValid(cache, 'http://localhost:11434/v1', 'qwen')).toBe(true);
    expect(shouldInvalidateCapabilityCache(cache, 'http://localhost:8000/v1', 'qwen')).toBe(true);
    expect(shouldInvalidateCapabilityCache(cache, 'http://localhost:11434/v1', 'other')).toBe(
      true
    );
    expect(shouldInvalidateCapabilityCache(cache, 'http://localhost:11434/v1', 'qwen')).toBe(
      false
    );
  });
});

describe('probeJsonSchemaCapability', () => {
  it('marks supported when the probe response conforms', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: '{"ok": true}' } }] }),
    });

    const result = await probeJsonSchemaCapability({
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen3.5:0.8b',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.supported).toBe(true);
    expect(result.field).toBe('ollama_format');
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1].body)) as Record<string, unknown>;
    expect(body).toHaveProperty('format');
  });

  it('marks unsupported on 4xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 422,
      text: async () => JSON.stringify({ error: 'bad request' }),
    });

    const result = await probeJsonSchemaCapability({
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'http://localhost:8000/v1',
      model: 'meta-llama',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.supported).toBe(false);
    expect(result.field).toBeNull();
  });
});
