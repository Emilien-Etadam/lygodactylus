/**
 * Schedules Ollama model warm-up from app config when the endpoint is Ollama.
 * Kept separate from config-store to avoid tight coupling / circular imports in tests.
 */
import { detectCommonProviderSetup } from '../../shared/api-provider-guidance';
import type { AppConfig } from './config-schema';
import { scheduleOllamaWarmUp } from './ollama-api';

export function scheduleWarmUpFromAppConfig(config: AppConfig): void {
  const baseUrl = config.baseUrl?.trim() || '';
  const model = config.model?.trim() || '';
  if (!model) {
    return;
  }
  if (detectCommonProviderSetup(baseUrl)?.id !== 'ollama') {
    return;
  }
  scheduleOllamaWarmUp({
    baseUrl,
    model,
    apiKey: config.apiKey,
    keepAlive: config.ollamaKeepAlive,
  });
}
