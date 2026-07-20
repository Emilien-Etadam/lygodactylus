/**
 * Main-process helpers to apply opt-in PII scrubbing at tool egress choke points.
 * Fail-closed: any internal scrub error blocks the outbound call.
 */

import {
  PiiScrubError,
  createPiiScrubSession,
  normalizePiiScrubConfig,
  type PiiScrubConfig,
  type PiiScrubSession,
} from '../../shared/pii-scrub';
import { configStore } from '../config/config-store';
import { mt } from '../i18n';
import type { HttpRequestOptions } from './http-request';

export const PII_MASKED_DETAILS_KEY = 'piiMaskedCount' as const;

export function readPiiScrubConfig(): PiiScrubConfig {
  try {
    return normalizePiiScrubConfig(configStore.get('piiScrub'));
  } catch {
    return normalizePiiScrubConfig(undefined);
  }
}

/** Returns a session when the feature is enabled; otherwise null (pass-through). */
export function beginPiiScrubSession(): PiiScrubSession | null {
  const config = readPiiScrubConfig();
  if (!config.enabled) {
    return null;
  }
  try {
    return createPiiScrubSession(config);
  } catch (error) {
    throw piiScrubToolError(error);
  }
}

export function piiScrubToolError(cause?: unknown): Error {
  const message = mt('errPiiScrubFailed');
  if (cause instanceof PiiScrubError) {
    return new Error(message, { cause });
  }
  return new Error(message, cause !== undefined ? { cause } : undefined);
}

export function scrubQueryForEgress(query: string, session: PiiScrubSession | null): string {
  if (!session) {
    return query;
  }
  try {
    return session.scrubText(query);
  } catch (error) {
    throw piiScrubToolError(error);
  }
}

export function scrubHttpOptionsForEgress(
  options: HttpRequestOptions,
  session: PiiScrubSession | null
): HttpRequestOptions {
  if (!session) {
    return options;
  }
  try {
    return {
      ...options,
      url: session.scrubUrl(options.url),
      headers: session.scrubHeaders(options.headers),
      body: typeof options.body === 'string' ? session.scrubText(options.body) : options.body,
    };
  } catch (error) {
    throw piiScrubToolError(error);
  }
}

export function scrubToolArgsForEgress(
  args: Record<string, unknown>,
  session: PiiScrubSession | null
): Record<string, unknown> {
  if (!session) {
    return args;
  }
  try {
    return session.scrubJsonValue(args);
  } catch (error) {
    throw piiScrubToolError(error);
  }
}

export function unscrubTextForModel(text: string, session: PiiScrubSession | null): string {
  if (!session || session.maskedCount === 0) {
    return text;
  }
  try {
    return session.unscrubText(text);
  } catch (error) {
    throw piiScrubToolError(error);
  }
}

export function unscrubUnknownForModel<T>(value: T, session: PiiScrubSession | null): T {
  if (!session || session.maskedCount === 0) {
    return value;
  }
  try {
    return unscrubUnknown(value, (text) => session.unscrubText(text)) as T;
  } catch (error) {
    throw piiScrubToolError(error);
  }
}

export function piiMaskedDetails(
  session: PiiScrubSession | null,
  extra?: Record<string, unknown>
): Record<string, unknown> | undefined {
  return mergePiiMaskedDetails(session?.maskedCount ?? 0, extra);
}

export function mergePiiMaskedDetails(
  maskedCount: number,
  extra?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (maskedCount <= 0 && !extra) {
    return undefined;
  }
  return {
    ...(extra ?? {}),
    ...(maskedCount > 0 ? { [PII_MASKED_DETAILS_KEY]: maskedCount } : {}),
  };
}

function unscrubUnknown(value: unknown, unscrubText: (text: string) => string): unknown {
  if (typeof value === 'string') {
    return unscrubText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => unscrubUnknown(item, unscrubText));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = unscrubUnknown(nested, unscrubText);
    }
    return out;
  }
  return value;
}
