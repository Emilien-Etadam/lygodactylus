import type { IncomingMessage, ServerResponse } from 'http';

const MOZ_EXTENSION_ORIGIN_RE = /^moz-extension:\/\//i;

export type WebActionCorsResult = 'allowed' | 'forbidden' | 'none';

export function isMozExtensionOrigin(origin: string): boolean {
  return MOZ_EXTENSION_ORIGIN_RE.test(origin.trim());
}

export function applyWebActionCors(req: IncomingMessage, res: ServerResponse): WebActionCorsResult {
  const origin = req.headers.origin;
  if (!origin || typeof origin !== 'string') {
    return 'none';
  }
  if (!isMozExtensionOrigin(origin)) {
    return 'forbidden';
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  return 'allowed';
}
