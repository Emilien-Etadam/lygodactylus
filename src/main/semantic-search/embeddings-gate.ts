import type { AppConfig } from '../config/config-schema';
import { isOfficialOpenAIBaseUrl } from '../config/auth-utils';
import { detectCommonProviderSetup } from '../../shared/api-provider-guidance';

/**
 * Mirrors MemoryLLMClient.embed skip rules: returns true only when an embeddings
 * call would actually hit a supported OpenAI-compatible endpoint.
 */
export function isMemoryEmbeddingEndpointUsable(config: AppConfig): boolean {
  const runtime = config.memoryRuntime;
  if (!runtime?.useEmbedding) {
    return false;
  }

  const embedding = runtime.embedding;
  const inherit = embedding?.inheritFromActive !== false;
  const explicitBaseUrl = embedding?.baseUrl?.trim() || '';
  const effectiveBaseUrl = explicitBaseUrl || config.baseUrl || '';

  const inheritsActiveEmbeddingEndpoint = inherit && !explicitBaseUrl;
  if (
    inheritsActiveEmbeddingEndpoint &&
    effectiveBaseUrl &&
    !isOfficialOpenAIBaseUrl(effectiveBaseUrl)
  ) {
    return false;
  }
  if (detectCommonProviderSetup(effectiveBaseUrl)?.id === 'vllm') {
    return false;
  }

  const provider = inherit ? config.provider : embedding?.provider || config.provider;
  if (provider !== 'openai') {
    return false;
  }

  // Explicit override URL, official OpenAI inherit, or empty base (defaults to OpenAI platform).
  return true;
}

/** Opt-in setting + usable embeddings endpoint → expose semantic_search to the model. */
export function isSemanticSearchToolEnabled(config: AppConfig): boolean {
  const runtime = config.memoryRuntime;
  if (!runtime?.semanticSearchEnabled) {
    return false;
  }
  return isMemoryEmbeddingEndpointUsable(config);
}
