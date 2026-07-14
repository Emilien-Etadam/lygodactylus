import { describe, expect, it, vi } from 'vitest';

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

import { redactSecrets } from '../src/main/chat-lan-server/chat-lan-redact';
import { isAllowedRpcChannel } from '../src/main/chat-lan-server/chat-lan-rpc';
import {
  broadcastChatLanEvent,
  subscribeChatLanEvents,
} from '../src/main/chat-lan-server/chat-lan-event-bus';
import { isAllowedClientEvent } from '../src/shared/client-event-allowlist';
import type { ServerEvent } from '../src/renderer/types';

describe('redactSecrets', () => {
  it('blanks nested API keys and tokens while keeping structure', () => {
    const config = {
      theme: 'dark',
      apiKey: 'sk-live-123',
      maxTokens: 4096,
      profiles: {
        openai: { apiKey: 'sk-oai', baseUrl: 'https://x' },
        anthropic: { apiKey: '' },
      },
      configSets: [{ profiles: { openai: { apiKey: 'sk-set' } } }],
      webSearch: { authToken: 'tok', provider: 'searxng' },
      memoryRuntime: { llm: { apiKey: 'sk-mem' } },
    };
    const redacted = redactSecrets(config);
    expect(redacted.theme).toBe('dark');
    expect(redacted.maxTokens).toBe(4096);
    expect(redacted.apiKey).toBe('__redacted__');
    expect(redacted.profiles.openai.apiKey).toBe('__redacted__');
    expect(redacted.profiles.anthropic.apiKey).toBe('');
    expect(redacted.configSets[0].profiles.openai.apiKey).toBe('__redacted__');
    expect(redacted.webSearch.authToken).toBe('__redacted__');
    expect(redacted.webSearch.provider).toBe('searxng');
    expect(redacted.memoryRuntime.llm.apiKey).toBe('__redacted__');
    expect(JSON.stringify(redacted)).not.toContain('sk-');
    // Source object untouched
    expect(config.apiKey).toBe('sk-live-123');
  });
});

describe('rpc allowlist', () => {
  it('accepts only chat-path channels', () => {
    expect(isAllowedRpcChannel('get-version')).toBe(true);
    expect(isAllowedRpcChannel('config.get')).toBe(true);
    expect(isAllowedRpcChannel('config.isConfigured')).toBe(true);
    expect(isAllowedRpcChannel('plugins.listCommands')).toBe(true);
    expect(isAllowedRpcChannel('mcp.getServerStatus')).toBe(true);
    expect(isAllowedRpcChannel('artifacts.listRecentFiles')).toBe(true);
  });

  it('rejects management and secret-bearing channels', () => {
    for (const channel of [
      'config.save',
      'config.createSet',
      'chatLan.getConfig',
      'mcp.saveServer',
      'marketplace.install',
      'plugins.setEnabled',
      'sandbox.setEnabled',
      'schedule.create',
      'memory.getOverview',
      'logs.write',
      'constructor',
      '__proto__',
      42,
      null,
    ]) {
      expect(isAllowedRpcChannel(channel)).toBe(false);
    }
  });
});

describe('chat-lan event bus', () => {
  it('mirrors chat-path events including traces and session.list', () => {
    const received: ServerEvent[] = [];
    const unsubscribe = subscribeChatLanEvents((e) => received.push(e));
    broadcastChatLanEvent({ type: 'trace.step', payload: { sessionId: 's' } } as ServerEvent);
    broadcastChatLanEvent({ type: 'session.list', payload: { sessions: [] } } as ServerEvent);
    broadcastChatLanEvent({ type: 'session.contextInfo', payload: {} } as ServerEvent);
    unsubscribe();
    expect(received.map((e) => e.type)).toEqual([
      'trace.step',
      'session.list',
      'session.contextInfo',
    ]);
  });

  it('drops desktop-only events', () => {
    const received: ServerEvent[] = [];
    const unsubscribe = subscribeChatLanEvents((e) => received.push(e));
    broadcastChatLanEvent({ type: 'navigate', payload: 'settings' } as unknown as ServerEvent);
    broadcastChatLanEvent({ type: 'new-session' } as unknown as ServerEvent);
    broadcastChatLanEvent({ type: 'update.checkResult', payload: {} } as ServerEvent);
    unsubscribe();
    expect(received).toHaveLength(0);
  });

  it('redacts secrets from config.status payloads', () => {
    const received: ServerEvent[] = [];
    const unsubscribe = subscribeChatLanEvents((e) => received.push(e));
    broadcastChatLanEvent({
      type: 'config.status',
      payload: {
        isConfigured: true,
        config: { theme: 'dark', apiKey: 'sk-live-123' },
      },
    } as unknown as ServerEvent);
    unsubscribe();
    expect(received).toHaveLength(1);
    const payload = received[0].payload as { isConfigured: boolean; config: { apiKey: string; theme: string } };
    expect(payload.isConfigured).toBe(true);
    expect(payload.config.theme).toBe('dark');
    expect(payload.config.apiKey).toBe('__redacted__');
  });
});

describe('bridge client-event validation', () => {
  it('reuses the shared allowlist', () => {
    expect(isAllowedClientEvent({ type: 'session.start', payload: {} })).toBe(true);
    expect(isAllowedClientEvent({ type: 'permission.response', payload: {} })).toBe(true);
    expect(isAllowedClientEvent({ type: 'evil.event', payload: {} })).toBe(false);
    expect(isAllowedClientEvent(null)).toBe(false);
    expect(isAllowedClientEvent('session.start')).toBe(false);
  });
});
