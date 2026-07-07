import type { AppConfig, CustomProtocolType, ProviderType } from '../config/config-store';
import { configStore } from '../config/config-store';
import { normalizeOpenAICompatibleBaseUrl, resolveOpenAICredentials, isOfficialOpenAIBaseUrl, OPENAI_PLATFORM_BASE_URL } from '../config/auth-utils';
import { detectCommonProviderSetup } from '../../shared/api-provider-guidance';
import { runPiAiOneShot } from '../agent/pi-ai-one-shot';
import { logWarn } from '../utils/logger';

export interface MemoryCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
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

export class MemoryLLMClient implements MemoryLLMClientLike {
  constructor(private readonly getConfig: () => AppConfig = () => configStore.getAll()) {}

  async complete(request: MemoryCompletionRequest): Promise<MemoryCompletionResponse> {
    const appConfig = this.getConfig();
    const llmConfig = normalizeModelConfig(
      appConfig,
      appConfig.memoryRuntime?.llm,
      appConfig.model
    );
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`Memory LLM request timed out after ${llmConfig.timeoutMs}ms`));
        }, llmConfig.timeoutMs);
        timeout.unref?.();
      });
      const result = await Promise.race([
        runPiAiOneShot(
          request.userPrompt,
          request.systemPrompt,
          buildAppConfig(appConfig, llmConfig),
          {
            temperature: request.temperature ?? 0,
            maxTokens: request.maxTokens ?? 16_000,
            signal: controller.signal,
          }
        ),
        timeoutPromise,
      ]);
      return { text: result.text };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
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
