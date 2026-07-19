import type { AppConfig, CustomProtocolType, ProviderType } from '../config/config-store';
import { configStore } from '../config/config-store';
import { normalizeOpenAICompatibleBaseUrl, resolveOpenAICredentials, isOfficialOpenAIBaseUrl, OPENAI_PLATFORM_BASE_URL } from '../config/auth-utils';
import { detectCommonProviderSetup } from '../../shared/api-provider-guidance';
import {
  GENERIC_JSON_OBJECT_SCHEMA,
  resolveActiveConstraintField,
} from '../config/endpoint-capabilities';
import { runPiAiOneShot } from '../agent/pi-ai-one-shot';
import { logWarn } from '../utils/logger';

export interface MemoryCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /** Flat JSON Schema for server-side constrained decoding when the endpoint supports it. */
  responseSchema?: Record<string, unknown>;
  responseSchemaName?: string;
}

export interface MemoryCompletionResponse {
  text: string;
}

export interface MemoryLLMClientLike {
  complete(request: MemoryCompletionRequest): Promise<MemoryCompletionResponse>;
  embed(text: string): Promise<number[]>;
}

interface MemoryModelConfig {
  inheritFromActive?: boolean;
  provider?: ProviderType;
  customProtocol?: CustomProtocolType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

interface ResolvedMemoryModelConfig {
  provider: ProviderType;
  customProtocol?: CustomProtocolType;
  apiKey: string;
  baseUrl?: string;
  model: string;
  timeoutMs: number;
}

function normalizeModelConfig(
  appConfig: AppConfig,
  input: MemoryModelConfig | undefined,
  fallbackModel: string
): ResolvedMemoryModelConfig {
  const inherit = input?.inheritFromActive !== false;
  const activeProvider = appConfig.provider;
  const activeProtocol = appConfig.customProtocol;
  const activeBaseUrl = appConfig.baseUrl;
  const activeApiKey = appConfig.apiKey;
  const activeModel = appConfig.model;

  const provider = inherit ? activeProvider : input?.provider || activeProvider;
  const customProtocol = inherit ? activeProtocol : input?.customProtocol || activeProtocol;
  const apiKey = inherit ? activeApiKey : input?.apiKey || '';
  const baseUrl = inherit ? activeBaseUrl : input?.baseUrl || activeBaseUrl;
  const model = (input?.model || (inherit ? activeModel : '') || fallbackModel).trim();
  const timeoutMs = Math.max(5_000, input?.timeoutMs || 180_000);

  return {
    provider,
    customProtocol,
    apiKey,
    baseUrl,
    model,
    timeoutMs,
  };
}

function buildAppConfig(base: AppConfig, resolved: ResolvedMemoryModelConfig): AppConfig {
  return {
    ...base,
    provider: resolved.provider,
    customProtocol: resolved.customProtocol,
    apiKey: resolved.apiKey,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
  };
}

async function runWithMemoryTimeout<T>(
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error(`Memory LLM request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timeout.unref?.();
    });
    return await Promise.race([fn(controller.signal), timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export class MemoryLLMClient implements MemoryLLMClientLike {
  constructor(private readonly getConfig: () => AppConfig = () => configStore.getAll()) {}

  async complete(request: MemoryCompletionRequest): Promise<MemoryCompletionResponse> {
    const appConfig = this.getConfig();
    const llmConfig = normalizeModelConfig(
      appConfig,
      appConfig.memoryRuntime?.llm,
      appConfig.model
    );

    const effectiveSchema =
      request.responseSchema ||
      (request.jsonMode === true ? { ...GENERIC_JSON_OBJECT_SCHEMA } : undefined);
    const oneShotConfig = buildAppConfig(appConfig, llmConfig);
    const canConstrain =
      Boolean(effectiveSchema) && resolveActiveConstraintField(oneShotConfig) !== null;

    const runPiAiCompletion = (withSchema: boolean): Promise<MemoryCompletionResponse> =>
      runWithMemoryTimeout(llmConfig.timeoutMs, async (signal) => {
        const result = await runPiAiOneShot(
          request.userPrompt,
          request.systemPrompt,
          oneShotConfig,
          {
            temperature: request.temperature ?? 0,
            maxTokens: request.maxTokens ?? 16_000,
            signal,
            ...(withSchema && effectiveSchema
              ? {
                  responseSchema: effectiveSchema,
                  responseSchemaName: request.responseSchemaName || 'memory_json',
                }
              : {}),
          }
        );
        return { text: result.text };
      });

    // Prefer server-side json_schema / format when capability was probed.
    if (canConstrain) {
      return runPiAiCompletion(true);
    }

    if (request.jsonMode === true && llmConfig.provider === 'openai') {
      try {
        const resolved = resolveOpenAICredentials({
          provider: llmConfig.provider,
          customProtocol: llmConfig.customProtocol,
          apiKey: llmConfig.apiKey,
          baseUrl: llmConfig.baseUrl,
        });
        const apiKey = resolved?.apiKey || llmConfig.apiKey;
        const baseURL =
          resolved?.baseUrl || normalizeOpenAICompatibleBaseUrl(llmConfig.baseUrl);

        return await runWithMemoryTimeout(llmConfig.timeoutMs, async (signal) => {
          const client = new (await import('openai')).default({
            apiKey,
            baseURL,
            timeout: llmConfig.timeoutMs,
          });
          const completion = await client.chat.completions.create(
            {
              model: llmConfig.model,
              temperature: request.temperature ?? 0,
              max_tokens: request.maxTokens ?? 16_000,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: request.systemPrompt },
                { role: 'user', content: request.userPrompt },
              ],
            },
            { signal }
          );
          return { text: completion.choices[0]?.message?.content ?? '' };
        });
      } catch (error) {
        logWarn(
          '[MemoryLLMClient] OpenAI JSON mode completion failed; falling back to pi-ai:',
          error
        );
        return runPiAiCompletion(false);
      }
    }

    return runPiAiCompletion(Boolean(effectiveSchema));
  }

  async embed(text: string): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) {
      return [];
    }

    const appConfig = this.getConfig();
    if (!appConfig.memoryRuntime?.useEmbedding) {
      return [];
    }
    const embedConfig = normalizeModelConfig(
      appConfig,
      appConfig.memoryRuntime.embedding,
      'text-embedding-3-small'
    );

    const effectiveBaseUrl = embedConfig.baseUrl || appConfig.baseUrl;
    const inheritsActiveEmbeddingEndpoint =
      appConfig.memoryRuntime?.embedding?.inheritFromActive !== false &&
      !appConfig.memoryRuntime?.embedding?.baseUrl?.trim();
    if (
      inheritsActiveEmbeddingEndpoint &&
      effectiveBaseUrl &&
      !isOfficialOpenAIBaseUrl(effectiveBaseUrl)
    ) {
      logWarn(
        '[MemoryLLMClient] Skipping embedding against inherited inference endpoint; using lexical retrieval instead:',
        effectiveBaseUrl
      );
      return [];
    }
    if (detectCommonProviderSetup(effectiveBaseUrl)?.id === 'vllm') {
      logWarn(
        '[MemoryLLMClient] Skipping embedding against vLLM endpoint (embeddings API not supported); using lexical retrieval'
      );
      return [];
    }

    const provider = embedConfig.provider;
    const protocol = embedConfig.customProtocol;
    const isOpenAiCompatible = provider === 'openai';

    if (!isOpenAiCompatible) {
      logWarn(
        '[MemoryLLMClient] Embedding requested for unsupported provider; returning empty embedding:',
        provider
      );
      return [];
    }

    const resolved = resolveOpenAICredentials({
      provider,
      customProtocol: protocol,
      apiKey: embedConfig.apiKey,
      baseUrl: embedConfig.baseUrl,
    });

    const apiKey = resolved?.apiKey || embedConfig.apiKey;
    const baseUrl =
      resolved?.baseUrl || normalizeOpenAICompatibleBaseUrl(embedConfig.baseUrl) || OPENAI_PLATFORM_BASE_URL;
    const embeddingsUrl = baseUrl.endsWith('/v1')
      ? `${baseUrl}/embeddings`
      : `${baseUrl}/v1/embeddings`;

    const response = await fetch(embeddingsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: embedConfig.model,
        input: trimmed,
      }),
      signal: AbortSignal.timeout(embedConfig.timeoutMs),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    return payload.data?.[0]?.embedding || [];
  }
}
