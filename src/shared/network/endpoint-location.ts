import { isLoopbackHostname, normalizeHostname } from './loopback';

export type EndpointLocationKind = 'local' | 'lan' | 'remote';

export interface EndpointLocation {
  kind: EndpointLocationKind;
  /** Hostname only (no port), lowercased; empty when the URL cannot be parsed. */
  host: string;
}

const DEFAULT_HOST_LABEL_MAX = 18;

function parseBaseUrl(baseUrl: string): URL | null {
  const value = baseUrl.trim();
  if (!value) {
    return null;
  }

  try {
    const normalized = value.includes('://') ? value : `http://${value}`;
    return new URL(normalized);
  } catch {
    return null;
  }
}

/** RFC1918 private IPv4 ranges (and not loopback — callers check loopback first). */
export function isRfc1918Hostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (!host) {
    return false;
  }

  if (/^10\./.test(host)) {
    return true;
  }
  if (/^192\.168\./.test(host)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
    return true;
  }

  return false;
}

/** mDNS / local network hostnames ending in `.local`. */
export function isLocalNetworkHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return host === 'local' || host.endsWith('.local');
}

/**
 * Classify where an API endpoint runs from its base URL alone (no network I/O).
 * Invalid / empty URLs degrade to `{ kind: 'remote', host: '' }`.
 */
export function describeEndpointLocation(baseUrl: string | undefined): EndpointLocation {
  const parsed = typeof baseUrl === 'string' ? parseBaseUrl(baseUrl) : null;
  if (!parsed) {
    return { kind: 'remote', host: '' };
  }

  const host = normalizeHostname(parsed.hostname);
  if (!host) {
    return { kind: 'remote', host: '' };
  }

  if (isLoopbackHostname(host)) {
    return { kind: 'local', host };
  }

  if (isRfc1918Hostname(host) || isLocalNetworkHostname(host)) {
    return { kind: 'lan', host };
  }

  return { kind: 'remote', host };
}

/**
 * Full endpoint URL safe for tooltips: never includes credentials, query string,
 * or fragment (API keys sometimes travel there).
 */
export function redactEndpointUrlForDisplay(baseUrl: string | undefined): string {
  const value = baseUrl?.trim();
  if (!value) {
    return '';
  }

  const parsed = parseBaseUrl(value);
  if (!parsed) {
    // Best-effort strip of userinfo / query / hash without throwing.
    return value
      .replace(/[?#].*$/, '')
      .replace(/\/\/([^/@]+)@/g, '//')
      .trim();
  }

  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  if (value.includes('://')) {
    return `${parsed.protocol}//${parsed.host}${path}`;
  }

  return `${parsed.host}${path}`;
}

/** Truncate a hostname for compact badge labels. */
export function truncateEndpointHost(
  host: string,
  maxLength: number = DEFAULT_HOST_LABEL_MAX
): string {
  const trimmed = host.trim();
  if (!trimmed || trimmed.length <= maxLength) {
    return trimmed;
  }
  if (maxLength <= 1) {
    return '…';
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}
