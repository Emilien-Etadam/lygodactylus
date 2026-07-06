import * as crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { URL } from 'url';
import { chatLanConfigStore } from './chat-lan-config-store';

export function timingSafeEqualString(
  provided: string | undefined,
  expected: string | undefined
): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }
  if (!provided || !expected) {
    return false;
  }
  const providedDigest = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

export function getBearerTokenFromRequest(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return null;
  }
  const token = auth.slice('Bearer '.length).trim();
  return token || null;
}

export function getTokenFromRequest(req: IncomingMessage, url: URL): string | null {
  const bearer = getBearerTokenFromRequest(req);
  if (bearer) {
    return bearer;
  }
  const queryToken = url.searchParams.get('token');
  return queryToken?.trim() || null;
}

export function isChatLanAuthorized(req: IncomingMessage, url: URL): boolean {
  const expected = chatLanConfigStore.getAll().token;
  const provided = getTokenFromRequest(req, url);
  return Boolean(provided && expected && timingSafeEqualString(provided, expected));
}

export function isWebActionAuthorized(req: IncomingMessage): boolean {
  const expected = chatLanConfigStore.getAll().extensionToken;
  const provided = getBearerTokenFromRequest(req);
  return Boolean(provided && expected && timingSafeEqualString(provided, expected));
}

export function applyChatLanSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'");
}
