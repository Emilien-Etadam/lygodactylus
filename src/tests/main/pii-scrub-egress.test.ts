import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../main/config/config-store', () => ({
  configStore: {
    get: vi.fn(),
  },
}));

vi.mock('../../main/i18n', () => ({
  mt: (key: string) => `translated:${key}`,
}));

import { configStore } from '../../main/config/config-store';
import {
  beginPiiScrubSession,
  piiMaskedDetails,
  rememberPiiMaskedCount,
  scrubHttpOptionsForEgress,
  scrubQueryForEgress,
  scrubToolArgsForEgress,
  takePiiMaskedCount,
  unscrubTextForModel,
} from '../../main/agent/pii-scrub-egress';

const mockedGet = vi.mocked(configStore.get);

describe('pii-scrub-egress', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null session when feature is off', () => {
    mockedGet.mockReturnValue({ enabled: false, customTerms: [] });
    expect(beginPiiScrubSession()).toBeNull();
  });

  it('scrubs query and restores response when enabled', () => {
    mockedGet.mockReturnValue({ enabled: true, customTerms: [] });
    const session = beginPiiScrubSession();
    expect(session).not.toBeNull();
    const scrubbed = scrubQueryForEgress('email alice@example.com', session);
    expect(scrubbed).toBe('email {{PII_1}}');
    expect(unscrubTextForModel('found {{PII_1}}', session)).toBe('found alice@example.com');
    expect(piiMaskedDetails(session)).toEqual({ piiMaskedCount: 1 });
  });

  it('scrubs URL query and body but keeps hostname/path', () => {
    mockedGet.mockReturnValue({ enabled: true, customTerms: ['Dupont'] });
    const session = beginPiiScrubSession();
    const scrubbed = scrubHttpOptionsForEgress(
      {
        url: 'https://api.example.com/v1/users?name=Dupont',
        headers: { 'X-Mail': 'a@b.com' },
        body: '{"phone":"06 12 34 56 78"}',
      },
      session
    );
    expect(scrubbed.url).toContain('https://api.example.com/v1/users?');
    expect(scrubbed.url).toContain('name=%7B%7BPII_');
    expect(scrubbed.url).not.toContain('Dupont');
    expect(scrubbed.headers?.['X-Mail']).toMatch(/^\{\{PII_\d+\}\}$/);
    expect(scrubbed.body).toMatch(/\{\{PII_\d+\}\}/);
  });

  it('scrubs nested MCP args', () => {
    mockedGet.mockReturnValue({ enabled: true, customTerms: [] });
    const session = beginPiiScrubSession();
    const scrubbed = scrubToolArgsForEgress(
      { input: { email: 'alice@example.com' } },
      session
    );
    expect(scrubbed).toEqual({ input: { email: '{{PII_1}}' } });
  });

  it('remembers masked count on result objects without logging the map', () => {
    const result = { content: [{ type: 'text', text: 'ok' }] };
    rememberPiiMaskedCount(result, 3);
    expect(takePiiMaskedCount(result)).toBe(3);
    expect(takePiiMaskedCount(result)).toBe(0);
  });

  it('fail-closed: oversized scrub input becomes a translated tool error', () => {
    mockedGet.mockReturnValue({ enabled: true, customTerms: [] });
    const session = beginPiiScrubSession();
    expect(() => scrubQueryForEgress('x'.repeat(2_000_001), session)).toThrow(
      'translated:errPiiScrubFailed'
    );
  });
});
