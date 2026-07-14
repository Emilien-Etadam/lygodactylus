import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { ServerResponse } from 'http';

vi.mock('../src/main/chat-lan-server/chat-lan-config-store', () => ({
  chatLanConfigStore: {
    getAll: () => ({
      enabled: true,
      port: 19890,
      token: 'secret-token',
      extensionToken: 'extension-token',
      publicUrl: '',
    }),
  },
}));

import { STATIC_FILES } from '../src/main/chat-lan-server/chat-lan-server';
import { applyChatLanSecurityHeaders } from '../src/main/chat-lan-server/chat-lan-auth';

const CHAT_LAN_DIR = path.join(__dirname, '..', 'resources', 'chat-lan');

function makeResponse(): { res: ServerResponse; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as ServerResponse;
  return { res, headers };
}

describe('chat-lan static files', () => {
  it('whitelist only contains safe relative paths', () => {
    for (const [route, entry] of Object.entries(STATIC_FILES)) {
      expect(route.startsWith('/')).toBe(true);
      expect(entry.file).not.toContain('..');
      expect(path.isAbsolute(entry.file)).toBe(false);
    }
  });

  it('every whitelisted file exists in resources/chat-lan', () => {
    for (const entry of Object.values(STATIC_FILES)) {
      expect(fs.existsSync(path.join(CHAT_LAN_DIR, entry.file)), entry.file).toBe(true);
    }
  });

  it('serves the PWA shell routes with correct MIME types', () => {
    expect(STATIC_FILES['/'].type).toContain('text/html');
    expect(STATIC_FILES['/app.js'].type).toContain('text/javascript');
    expect(STATIC_FILES['/styles.css'].type).toContain('text/css');
    expect(STATIC_FILES['/sw.js'].type).toContain('text/javascript');
    expect(STATIC_FILES['/manifest.webmanifest'].type).toBe('application/manifest+json');
    expect(STATIC_FILES['/icons/icon-192.png'].type).toBe('image/png');
  });

  it('keeps html/js/css revalidated and never long-caches the service worker', () => {
    expect(STATIC_FILES['/'].cache).toBe('no-cache');
    expect(STATIC_FILES['/app.js'].cache).toBe('no-cache');
    expect(STATIC_FILES['/sw.js'].cache).toBe('no-cache');
    expect(STATIC_FILES['/icons/icon-512.png'].cache).toContain('max-age');
  });

  it('manifest is valid JSON with the fields Android requires', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(CHAT_LAN_DIR, 'manifest.webmanifest'), 'utf8')
    );
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    const purposes = manifest.icons.map((icon: { purpose?: string }) => icon.purpose);
    expect(purposes).toContain('maskable');
    for (const icon of manifest.icons) {
      expect(fs.existsSync(path.join(CHAT_LAN_DIR, icon.src.replace(/^\//, '')))).toBe(true);
    }
  });

  it('index.html has no inline script (CSP default-src self would block it)', () => {
    const html = fs.readFileSync(path.join(CHAT_LAN_DIR, 'index.html'), 'utf8');
    const inlineScripts = html.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) || [];
    expect(inlineScripts).toHaveLength(0);
    expect(html).toContain('<script src="/app.js"');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
  });

  it('service worker never caches API routes', () => {
    const sw = fs.readFileSync(path.join(CHAT_LAN_DIR, 'sw.js'), 'utf8');
    expect(sw).toContain("startsWith('/api/')");
  });
});

describe('applyChatLanSecurityHeaders cache control', () => {
  it('defaults to no-store for API responses', () => {
    const { res, headers } = makeResponse();
    applyChatLanSecurityHeaders(res);
    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
  });

  it('accepts a relaxed value for static assets', () => {
    const { res, headers } = makeResponse();
    applyChatLanSecurityHeaders(res, 'public, max-age=86400');
    expect(headers['Cache-Control']).toBe('public, max-age=86400');
  });
});
