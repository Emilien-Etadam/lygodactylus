import type { ApiTestInput, ApiTestResult } from '../../renderer/types';
import type { AppConfig } from './config-schema';
import { probeWithPiAi } from '../agent/pi-ai-one-shot';
import { refreshConstrainedOutputCapability } from './endpoint-capabilities';
import { configStore } from './config-store';
import { logWarn } from '../utils/logger';

export async function runConfigApiTest(
  payload: ApiTestInput,
  config: AppConfig
): Promise<ApiTestResult> {
  const result = await probeWithPiAi(payload, config);
  if (result.ok) {
    // Best-effort capability probe — never fail the connection test.
    void refreshConstrainedOutputCapability(
      {
        provider: payload.provider,
        customProtocol: payload.customProtocol,
        apiKey: payload.apiKey ?? config.apiKey,
        baseUrl: payload.baseUrl ?? config.baseUrl,
        model: (typeof payload.model === 'string' ? payload.model : config.model) || '',
      },
      {
        getConfig: () => configStore.getAll(),
        saveCapability: (cache) => {
          configStore.update({ constrainedOutputCapability: cache });
        },
      }
    ).catch((error) => {
      logWarn('[ConfigTest] Constrained-output capability probe failed silently:', error);
    });
  }
  return result;
}
