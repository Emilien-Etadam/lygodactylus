import { describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  applyWebActionCors,
  isMozExtensionOrigin,
} from '../src/main/chat-lan-server/chat-lan-cors';

function makeRequest(origin?: string): IncomingMessage {
  return {
    headers: origin ? { origin } : {},
  } as IncomingMessage;
}

function makeResponse(): { res: ServerResponse; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as ServerResponse;
  return { res, headers };
}

describe('chat-lan-cors', () => {
  it('accepts moz-extension origins', () => {
    expect(isMozExtensionOrigin('moz-extension://abc-123')).toBe(true);
    expect(isMozExtensionOrigin('https://example.com')).toBe(false);
  });

  it('allows CORS for moz-extension preflight', () => {
    const req = makeRequest('moz-extension://abc-123');
    const { res, headers } = makeResponse();
    expect(applyWebActionCors(req, res)).toBe('allowed');
    expect(headers['Access-Control-Allow-Origin']).toBe('moz-extension://abc-123');
    expect(headers['Access-Control-Allow-Headers']).toContain('Authorization');
  });

  it('rejects non-extension browser origins', () => {
    const req = makeRequest('https://evil.example');
    const { res } = makeResponse();
    expect(applyWebActionCors(req, res)).toBe('forbidden');
  });

  it('skips CORS when origin header is absent', () => {
    const req = makeRequest();
    const { res } = makeResponse();
    expect(applyWebActionCors(req, res)).toBe('none');
  });
});
