import { describe, expect, it } from 'vitest';
import {
  PiiScrubError,
  createPiiScrubSession,
  findPiiMatches,
  isValidIban,
  isValidLuhn,
  normalizePiiScrubConfig,
  scrubTextOrThrow,
} from '../../shared/pii-scrub';

describe('normalizePiiScrubConfig', () => {
  it('defaults to disabled with empty terms', () => {
    expect(normalizePiiScrubConfig(undefined)).toEqual({ enabled: false, customTerms: [] });
  });

  it('trims, dedupes and caps custom terms', () => {
    const config = normalizePiiScrubConfig({
      enabled: true,
      customTerms: ['  Dupont  ', 'dupont', 'Marie Curie', '', 12, 'x'.repeat(300)],
    });
    expect(config.enabled).toBe(true);
    expect(config.customTerms).toEqual(['Dupont', 'Marie Curie']);
  });
});

describe('email detector', () => {
  it('masks emails', () => {
    const session = createPiiScrubSession({ enabled: true, customTerms: [] });
    const scrubbed = session.scrubText('Contact me at alice@example.com please');
    expect(scrubbed).toBe('Contact me at {{PII_1}} please');
    expect(session.maskedCount).toBe(1);
  });

  it('does not invent emails from plain words', () => {
    const matches = findPiiMatches('send to alice at example dot com');
    expect(matches.filter((m) => m.kind === 'email')).toHaveLength(0);
  });
});

describe('phone detector', () => {
  it('masks French national numbers', () => {
    const session = createPiiScrubSession({ enabled: true, customTerms: [] });
    expect(session.scrubText('Appelle le 06 12 34 56 78')).toBe('Appelle le {{PII_1}}');
  });

  it('masks French +33 and E.164 numbers', () => {
    const fr = createPiiScrubSession({ enabled: true, customTerms: [] });
    expect(fr.scrubText('Intl +33 6 12 34 56 78')).toContain('{{PII_1}}');
    const us = createPiiScrubSession({ enabled: true, customTerms: [] });
    expect(us.scrubText('US +1 202-555-0173')).toContain('{{PII_1}}');
  });

  it('does not treat version numbers as phones', () => {
    const matches = findPiiMatches('Release 1.2.3 and build 10.0.1.5');
    expect(matches.filter((m) => m.kind === 'phone')).toHaveLength(0);
  });
});

describe('IBAN detector', () => {
  it('masks a valid French IBAN (mod-97)', () => {
    // Well-known valid FR IBAN sample.
    const iban = 'FR14 2004 1010 0505 0001 3M02 606';
    expect(isValidIban(iban)).toBe(true);
    const session = createPiiScrubSession({ enabled: true, customTerms: [] });
    expect(session.scrubText(`Virement ${iban} merci`)).toBe('Virement {{PII_1}} merci');
  });

  it('does not mask an IBAN that fails mod-97', () => {
    const invalid = 'FR14 2004 1010 0505 0001 3M02 607';
    expect(isValidIban(invalid)).toBe(false);
    const matches = findPiiMatches(`Compte ${invalid}`);
    expect(matches.filter((m) => m.kind === 'iban')).toHaveLength(0);
  });
});

describe('card detector (Luhn)', () => {
  it('masks a valid Visa test number', () => {
    expect(isValidLuhn('4111111111111111')).toBe(true);
    const session = createPiiScrubSession({ enabled: true, customTerms: [] });
    expect(session.scrubText('Card 4111 1111 1111 1111')).toBe('Card {{PII_1}}');
  });

  it('does not mask a Luhn-invalid number', () => {
    expect(isValidLuhn('4111111111111112')).toBe(false);
    const matches = findPiiMatches('Card 4111 1111 1111 1112');
    expect(matches.filter((m) => m.kind === 'card')).toHaveLength(0);
  });
});

describe('custom terms', () => {
  it('masks user terms case-insensitively', () => {
    const session = createPiiScrubSession({
      enabled: true,
      customTerms: ['Dupont', '12 rue de la Paix'],
    });
    const scrubbed = session.scrubText('M. dupont habite 12 Rue de la Paix');
    expect(scrubbed).toBe('M. {{PII_1}} habite {{PII_2}}');
    expect(session.maskedCount).toBe(2);
  });

  it('treats regex metacharacters as literals', () => {
    const session = createPiiScrubSession({
      enabled: true,
      customTerms: ['a+b*', 'foo.bar'],
    });
    expect(session.scrubText('code a+b* and foo.bar')).toBe('code {{PII_1}} and {{PII_2}}');
    expect(session.scrubText('code aaaa')).toBe('code aaaa');
  });
});

describe('scrub ↔ unscrub round-trip', () => {
  it('restores the original text identity', () => {
    const session = createPiiScrubSession({
      enabled: true,
      customTerms: ['SecretName'],
    });
    const original =
      'Email alice@example.com phone 06 12 34 56 78 card 4111-1111-1111-1111 name SecretName';
    const scrubbed = session.scrubText(original);
    expect(scrubbed).not.toContain('alice@example.com');
    expect(scrubbed).toContain('{{PII_');
    expect(session.unscrubText(scrubbed)).toBe(original);
  });

  it('reuses the same token for identical values', () => {
    const session = createPiiScrubSession({ enabled: true, customTerms: [] });
    const scrubbed = session.scrubText('a@x.com and again a@x.com');
    expect(scrubbed).toBe('{{PII_1}} and again {{PII_1}}');
    expect(session.maskedCount).toBe(1);
  });

  it('scrubs URL query params and body-like values but not hostname/path', () => {
    const session = createPiiScrubSession({ enabled: true, customTerms: [] });
    const url = 'https://api.example.com/v1/search?q=alice@example.com&page=1';
    const scrubbed = session.scrubUrl(url);
    expect(scrubbed.startsWith('https://api.example.com/v1/search?')).toBe(true);
    // URLSearchParams percent-encodes { } in query values.
    expect(scrubbed).toContain('q=%7B%7BPII_1%7D%7D');
    expect(scrubbed).not.toContain('alice@example.com');
    expect(new URL(scrubbed).hostname).toBe('api.example.com');
    expect(new URL(scrubbed).pathname).toBe('/v1/search');
  });

  it('scrubs nested JSON arguments', () => {
    const session = createPiiScrubSession({ enabled: true, customTerms: ['Dupont'] });
    const scrubbed = session.scrubJsonValue({
      query: 'find Dupont',
      headers: { 'X-User': 'alice@example.com' },
      nested: [{ phone: '06 12 34 56 78' }],
    });
    expect(scrubbed).toEqual({
      query: 'find {{PII_1}}',
      headers: { 'X-User': '{{PII_2}}' },
      nested: [{ phone: '{{PII_3}}' }],
    });
  });
});

describe('fail-closed', () => {
  it('throws PiiScrubError for oversized input instead of sending raw text', () => {
    const session = createPiiScrubSession({ enabled: true, customTerms: [] });
    const huge = 'a'.repeat(2_000_001);
    expect(() => scrubTextOrThrow(huge, session)).toThrow(PiiScrubError);
  });

  it('wraps unexpected session errors as PiiScrubError', () => {
    const session = createPiiScrubSession({ enabled: true, customTerms: [] });
    const broken = {
      ...session,
      scrubText: () => {
        throw new TypeError('boom');
      },
    };
    expect(() => scrubTextOrThrow('alice@example.com', broken)).toThrow(PiiScrubError);
  });
});
