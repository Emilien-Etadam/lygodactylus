/**
 * @module main/config/endpoint-capabilities
 *
 * Detects whether a local OpenAI-compatible endpoint honors server-side
 * JSON-schema constrained decoding (response_format / Ollama format),
 * caches the result per endpoint+model, and builds request payload patches.
 *
 * Optional feature: failures degrade silently to unconstrained requests.
 */
import { detectCommonProviderSetup } from '../../shared/api-provider-guidance';
import {
  isLoopbackOpenAIEndpoint,
  normalizeOllamaBaseUrl,
  normalizeOpenAICompatibleBaseUrl,
  resolveOpenAICredentials,
} from './auth-utils';
import type {
  AppConfig,
  ConstrainedOutputCapabilityCache,
  ConstrainedOutputField,
  ConstrainedOutputMode,
  CustomProtocolType,
  ProviderType,
} from './config-schema';
import { log, logWarn } from '../utils/logger';

export type {
  ConstrainedOutputCapabilityCache,
  ConstrainedOutputField,
  ConstrainedOutputMode,
};

export type EndpointConstraintKind = 'ollama' | 'openai_compatible' | 'unsupported';

/** Trivial schema used only for capability probing. */
export const PROBE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
  },
  required: ['ok'],
  additionalProperties: false,
} as const;

export const GENERIC_JSON_OBJECT_SCHEMA = {
  type: 'object',
} as const;

const PROBE_MAX_TOKENS = 32;
const PROBE_TIMEOUT_MS = 12_000;

export function normalizeConstrainedOutputMode(value: unknown): ConstrainedOutputMode {
  return value === 'off' ? 'off' : 'auto';
}

export function normalizeConstrainedOutputCapability(
  value: unknown
): ConstrainedOutputCapabilityCache | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Partial<ConstrainedOutputCapabilityCache>;
  if (typeof raw.baseUrl !== 'string' || typeof raw.model !== 'string') {
    return null;
  }
  if (typeof raw.supported !== 'boolean') {
    return null;
  }
  const field =
    raw.field === 'ollama_format' || raw.field === 'openai_json_schema' ? raw.field : null;
  return {
    baseUrl: raw.baseUrl.trim(),
    model: raw.model.trim(),
    supported: raw.supported,
    field: raw.supported ? field : null,
    probedAt: typeof raw.probedAt === 'string' ? raw.probedAt : new Date(0).toISOString(),
  };
}

/**
 * Map endpoint type → constraint field.
 * Anthropic-compatible endpoints are unsupported (no OpenAI response_format).
 */
export function resolveEndpointConstraintKind(input: {
  baseUrl?: string;
  provider?: ProviderType;
  customProtocol?: CustomProtocolType;
}): EndpointConstraintKind {
  const protocol = input.customProtocol || (input.provider === 'openai' ? 'openai' : 'anthropic');
  if (protocol === 'anthropic' || input.provider === 'anthropic') {
    return 'unsupported';
  }

  const setup = detectCommonProviderSetup(input.baseUrl);
  if (setup?.id === 'ollama') {
    return 'ollama';
  }
  // vLLM, llama.cpp OpenAI server, generic OpenAI-compatible local endpoints.
  if (setup?.id === 'vllm' || setup?.id === 'generic-openai') {
    return 'openai_compatible';
  }
  if (input.baseUrl?.trim()) {
    return 'openai_compatible';
  }
  return 'unsupported';
}

export function constraintFieldForEndpointKind(
  kind: EndpointConstraintKind
): ConstrainedOutputField | null {
  switch (kind) {
    case 'ollama':
      return 'ollama_format';
    case 'openai_compatible':
      return 'openai_json_schema';
    default:
      return null;
  }
}

export function buildCapabilityCacheKey(baseUrl: string, model: string): string {
  return `${baseUrl.trim()}::${model.trim()}`;
}

export function isCapabilityCacheValid(
  cache: ConstrainedOutputCapabilityCache | null | undefined,
  baseUrl: string,
  model: string
): boolean {
  if (!cache) {
    return false;
  }
  return (
    cache.baseUrl.trim() === baseUrl.trim() &&
    cache.model.trim() === model.trim()
  );
}

/** Invalidate cached capability when URL or model identity changes. */
export function shouldInvalidateCapabilityCache(
  cache: ConstrainedOutputCapabilityCache | null | undefined,
  nextBaseUrl: string | undefined,
  nextModel: string | undefined
): boolean {
  if (!cache) {
    return false;
  }
  const url = (nextBaseUrl || '').trim();
  const model = (nextModel || '').trim();
  return cache.baseUrl.trim() !== url || cache.model.trim() !== model;
}

export function buildConstraintPayloadPatch(
  field: ConstrainedOutputField,
  schema: Record<string, unknown>,
  schemaName = 'constrained_output'
): Record<string, unknown> {
  if (field === 'ollama_format') {
    return { format: schema };
  }
  return {
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: schemaName,
        strict: true,
        schema,
      },
    },
  };
}

export function applyConstraintToPayload(
  payload: Record<string, unknown>,
  field: ConstrainedOutputField,
  schema: Record<string, unknown>,
  schemaName?: string
): Record<string, unknown> {
  return {
    ...payload,
    ...buildConstraintPayloadPatch(field, schema, schemaName),
  };
}

export function stripConstraintFromPayload(
  payload: Record<string, unknown>,
  field: ConstrainedOutputField
): Record<string, unknown> {
  const next = { ...payload };
  if (field === 'ollama_format') {
    delete next.format;
  } else {
    delete next.response_format;
  }
  return next;
}

export interface ProbeParseResult {
  conforming: boolean;
  reason?: 'http_error' | 'non_conforming' | 'empty';
}

/**
 * Parse a probe HTTP response: does the body contain valid JSON matching the
 * trivial `{ ok: boolean }` schema?
 */
export function parseProbeResponse(input: {
  httpStatus: number;
  bodyText: string;
}): ProbeParseResult {
  if (input.httpStatus < 200 || input.httpStatus >= 300) {
    return { conforming: false, reason: 'http_error' };
  }
  const trimmed = input.bodyText.trim();
  if (!trimmed) {
    return { conforming: false, reason: 'empty' };
  }

  let content = trimmed;
  try {
    const envelope = JSON.parse(trimmed) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      message?: { content?: unknown };
      response?: unknown;
    };
    const choiceContent = envelope.choices?.[0]?.message?.content;
    if (typeof choiceContent === 'string') {
      content = choiceContent;
    } else if (typeof envelope.message?.content === 'string') {
      content = envelope.message.content;
    } else if (typeof envelope.response === 'string') {
      content = envelope.response;
    }
  } catch {
    // Body may already be the JSON object itself.
  }

  const candidate = extractJsonObject(content);
  if (!candidate || typeof candidate !== 'object') {
    return { conforming: false, reason: 'non_conforming' };
  }
  if (typeof (candidate as { ok?: unknown }).ok !== 'boolean') {
    return { conforming: false, reason: 'non_conforming' };
  }
  return { conforming: true };
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export interface CapabilityProbeInput {
  provider: ProviderType;
  customProtocol?: CustomProtocolType;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function resolveProbeBaseUrl(input: CapabilityProbeInput): string | undefined {
  const raw = input.baseUrl?.trim();
  if (!raw) {
    return undefined;
  }
  const protocol = input.customProtocol || (input.provider === 'openai' ? 'openai' : 'anthropic');
  if (protocol !== 'openai') {
    return raw.replace(/\/+$/, '');
  }
  if (
    isLoopbackOpenAIEndpoint({
      provider: input.provider,
      baseUrl: raw,
    })
  ) {
    return normalizeOllamaBaseUrl(raw) || normalizeOpenAICompatibleBaseUrl(raw) || raw;
  }
  return normalizeOpenAICompatibleBaseUrl(raw) || raw;
}

function chatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (normalized.endsWith('/v1')) {
    return `${normalized}/chat/completions`;
  }
  if (normalized.includes('/v1/')) {
    return `${normalized.replace(/\/chat\/completions$/i, '')}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
}

/**
 * Probe whether the endpoint honors a trivial json_schema / format constraint.
 * Never throws — returns unsupported on any failure.
 */
export async function probeJsonSchemaCapability(
  input: CapabilityProbeInput
): Promise<ConstrainedOutputCapabilityCache> {
  const baseUrl = resolveProbeBaseUrl(input) || '';
  const model = input.model.trim();
  const kind = resolveEndpointConstraintKind({
    baseUrl,
    provider: input.provider,
    customProtocol: input.customProtocol,
  });
  const field = constraintFieldForEndpointKind(kind);
  const probedAt = new Date().toISOString();

  if (!field || !baseUrl || !model) {
    return {
      baseUrl,
      model,
      supported: false,
      field: null,
      probedAt,
    };
  }

  const credentials = resolveOpenAICredentials({
    provider: input.provider,
    customProtocol: input.customProtocol,
    apiKey: input.apiKey || '',
    baseUrl,
  });
  const apiKey = credentials?.apiKey || input.apiKey || 'sk-local';
  const fetchImpl = input.fetchImpl || fetch;
  const timeoutMs = input.timeoutMs ?? PROBE_TIMEOUT_MS;

  const body: Record<string, unknown> = {
    model,
    stream: false,
    temperature: 0,
    max_tokens: PROBE_MAX_TOKENS,
    messages: [
      {
        role: 'system',
        content: 'Reply with JSON only. No markdown.',
      },
      {
        role: 'user',
        content: 'Return {"ok": true}',
      },
    ],
    ...buildConstraintPayloadPatch(field, { ...PROBE_JSON_SCHEMA }, 'capability_probe'),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    const response = await fetchImpl(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    const parsed = parseProbeResponse({ httpStatus: response.status, bodyText });
    if (!parsed.conforming) {
      log(
        '[EndpointCapabilities] Probe unsupported:',
        field,
        parsed.reason,
        `status=${response.status}`
      );
      return { baseUrl, model, supported: false, field: null, probedAt };
    }
    log('[EndpointCapabilities] Probe supported via', field, 'for', model);
    return { baseUrl, model, supported: true, field, probedAt };
  } catch (error) {
    logWarn('[EndpointCapabilities] Probe network/error — treating as unsupported:', error);
    return { baseUrl, model, supported: false, field: null, probedAt };
  } finally {
    clearTimeout(timer);
  }
}

export function isConstrainedOutputEnabled(
  mode: ConstrainedOutputMode | undefined,
  cache: ConstrainedOutputCapabilityCache | null | undefined
): boolean {
  if (mode === 'off') {
    return false;
  }
  return cache?.supported === true && cache.field !== null;
}

export function resolveActiveConstraintField(
  config: Pick<AppConfig, 'constrainedOutput' | 'constrainedOutputCapability' | 'baseUrl' | 'model'>
): ConstrainedOutputField | null {
  if (config.constrainedOutput === 'off') {
    return null;
  }
  const cache = config.constrainedOutputCapability;
  if (!cache || !isCapabilityCacheValid(cache, config.baseUrl || '', config.model || '')) {
    return null;
  }
  if (!cache.supported || !cache.field) {
    return null;
  }
  return cache.field;
}

/**
 * Run completeSimple/stream options with onPayload constraint injection.
 * On constraint-related failure, retries immediately without the field.
 */
export async function withConstrainedOutputFallback<T>(options: {
  field: ConstrainedOutputField | null;
  schema: Record<string, unknown> | null | undefined;
  schemaName?: string;
  run: (onPayload?: (payload: unknown) => unknown) => Promise<T>;
  isConstraintError?: (error: unknown) => boolean;
}): Promise<T> {
  const field = options.field;
  const schema = options.schema;
  if (!field || !schema) {
    return options.run(undefined);
  }

  const constrainedOnPayload = (payload: unknown): unknown => {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }
    return applyConstraintToPayload(
      payload as Record<string, unknown>,
      field,
      schema,
      options.schemaName
    );
  };

  try {
    return await options.run(constrainedOnPayload);
  } catch (error) {
    const shouldRetry =
      options.isConstraintError?.(error) ?? isLikelyConstraintFieldError(error);
    if (!shouldRetry) {
      throw error;
    }
    log(
      '[EndpointCapabilities] Constraint field rejected — retrying without',
      field,
      error instanceof Error ? error.message : String(error)
    );
    return options.run(undefined);
  }
}

export function isLikelyConstraintFieldError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('response_format') ||
    message.includes('json_schema') ||
    message.includes('guided') ||
    message.includes('"format"') ||
    /\bformat\b.*(?:not supported|unknown|invalid|unexpected)/i.test(message) ||
    message.includes('additional properties') ||
    message.includes('extra fields') ||
    message.includes('unsupported field') ||
    message.includes('400') ||
    message.includes('422')
  );
}

export interface CapabilityRefreshDeps {
  getConfig: () => AppConfig;
  saveCapability: (cache: ConstrainedOutputCapabilityCache | null) => void;
  fetchImpl?: typeof fetch;
}

/**
 * Probe and persist capability for the given endpoint credentials when mode is
 * 'auto' and the cache is missing or stale for this URL+model.
 */
export async function refreshConstrainedOutputCapability(
  input: CapabilityProbeInput,
  deps: CapabilityRefreshDeps
): Promise<ConstrainedOutputCapabilityCache | null> {
  const config = deps.getConfig();
  if (normalizeConstrainedOutputMode(config.constrainedOutput) === 'off') {
    return null;
  }

  const baseUrl = resolveProbeBaseUrl(input) || '';
  const model = input.model.trim();
  if (!baseUrl || !model) {
    return null;
  }

  if (isCapabilityCacheValid(config.constrainedOutputCapability, baseUrl, model)) {
    return config.constrainedOutputCapability;
  }

  const result = await probeJsonSchemaCapability({
    ...input,
    baseUrl,
    model,
    fetchImpl: deps.fetchImpl,
  });
  deps.saveCapability(result);
  return result;
}
