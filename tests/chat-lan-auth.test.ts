import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';

vi.mock('../src/main/chat-lan-server/chat-lan-config-store', () => ({
  chatLanConfigStore: {
    getAll: () => ({
      enabled: true,
      port: 19890,
      token: 'secret-token',
      extensionToken: 'extension-token',
    }),
  },
}));

import {
  applyChatLanSecurityHeaders,
  getBearerTokenFromRequest,
  getTokenFromRequest,
  isChatLanAuthorized,
  isWebActionAuthorized,
  timingSafeEqualString,
} from '../src/main/chat-lan-server/chat-lan-auth';

function makeRequest(headers: Record<string, string | string[] | undefined> = {}): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe('chat-lan-auth', () => {
  describe('timingSafeEqualString', () => {
    it('returns false for empty tokens', () => {
      expect(timingSafeEqualString('', 'secret-token')).toBe(false);
      expect(timingSafeEqualString('secret-token', '')).toBe(false);
      expect(timingSafeEqualString('', '')).toBe(false);
    });

    it('returns false for undefined or non-string values', () => {
      expect(timingSafeEqualString(undefined, 'secret-token')).toBe(false);
      expect(timingSafeEqualString('secret-token', undefined)).toBe(false);
      expect(timingSafeEqualString(null as unknown as string, 'secret-token')).toBe(false);
      expect(timingSafeEqualString('secret-token', 42 as unknown as string)).toBe(false);
    });

    it('returns false for tokens with different lengths', () => {
      expect(timingSafeEqualString('short', 'much-longer-token')).toBe(false);
    });

    it('returns true for matching valid tokens', () => {
      expect(timingSafeEqualString('secret-token', 'secret-token')).toBe(true);
      expect(timingSafeEqualString('secret-token', 'wrong-token')).toBe(false);
    });
  });

  it('accepts bearer authorization header for chat LAN token', () => {
    const req = makeRequest({ authorization: 'Bearer secret-token' });
    const url = new URL('http://localhost/api/health');
    expect(getTokenFromRequest(req, url)).toBe('secret-token');
    expect(isChatLanAuthorized(req, url)).toBe(true);
  });

  it('accepts legacy query token for chat LAN routes', () => {
    const req = makeRequest();
    const url = new URL('http://localhost/api/events?token=secret-token');
    expect(isChatLanAuthorized(req, url)).toBe(true);
  });

  it('rejects extension token on chat LAN routes', () => {
    const req = makeRequest({ authorization: 'Bearer extension-token' });
    const url = new URL('http://localhost/api/health');
    expect(isChatLanAuthorized(req, url)).toBe(false);
  });

  it('accepts extension token via bearer header for web action', () => {
    const req = makeRequest({ authorization: 'Bearer extension-token' });
    expect(getBearerTokenFromRequest(req)).toBe('extension-token');
    expect(isWebActionAuthorized(req)).toBe(true);
  });

  it('rejects chat LAN token on web action', () => {
    const req = makeRequest({ authorization: 'Bearer secret-token' });
    expect(isWebActionAuthorized(req)).toBe(false);
  });

  it('rejects query token for web action', () => {
    const req = makeRequest();
    const url = new URL('http://localhost/api/web-action?token=extension-token');
    expect(getBearerTokenFromRequest(req)).toBeNull();
    expect(isWebActionAuthorized(req)).toBe(false);
    expect(url.searchParams.get('token')).toBe('extension-token');
  });

  it('rejects missing or invalid chat LAN tokens', () => {
    const req = makeRequest();
    const url = new URL('http://localhost/api/health');
    expect(isChatLanAuthorized(req, url)).toBe(false);

    const badReq = makeRequest({ authorization: 'Bearer wrong-token' });
    expect(isChatLanAuthorized(badReq, url)).toBe(false);
  });

  it('applies security headers', () => {
    const headers: Record<string, string | number | string[]> = {};
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as ServerResponse;

    applyChatLanSecurityHeaders(res);

    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['Cache-Control']).toBe('no-store');
    expect(String(headers['Content-Security-Policy'])).toContain("default-src 'self'");
  });
});
