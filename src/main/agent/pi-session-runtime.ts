import { createHash } from 'node:crypto';

export interface PiSessionRuntimeSignatureInput {
  configProvider?: string;
  customProtocol?: string;
  modelProvider?: string;
  modelApi?: string;
  modelBaseUrl?: string;
  effectiveCwd?: string;
  apiKey?: string;
  /** Plan/Act mode — changing mode recreates the cached pi session. */
  sessionMode?: string;
}

function normalizeText(value: string | undefined): string {
  return value?.trim() || '';
}

function fingerprintSecret(value: string | undefined): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  return createHash('sha256').update(normalized).digest('hex');
}

export function buildPiSessionRuntimeSignature(
  input: PiSessionRuntimeSignatureInput,
): string {
  const signature: Record<string, string> = {
    configProvider: normalizeText(input.configProvider),
    customProtocol: normalizeText(input.customProtocol),
    modelProvider: normalizeText(input.modelProvider),
    modelApi: normalizeText(input.modelApi),
    modelBaseUrl: normalizeText(input.modelBaseUrl).replace(/\/+$/, ''),
    effectiveCwd: normalizeText(input.effectiveCwd),
    apiKeyFingerprint: fingerprintSecret(input.apiKey),
  };
  // Keep act-mode signatures byte-identical to pre-plan/act builds so the
  // default path does not force a pi-session recreate. Only plan mode adds a key.
  const sessionMode = normalizeText(input.sessionMode) || 'act';
  if (sessionMode === 'plan') {
    signature.sessionMode = 'plan';
  }
  return JSON.stringify(signature);
}
