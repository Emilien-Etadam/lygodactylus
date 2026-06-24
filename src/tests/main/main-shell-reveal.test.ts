import { describe, it, expect } from 'vitest';
import { sanitizeDiagnosticBaseUrl } from '../../main/main-shell-reveal';

describe('sanitizeDiagnosticBaseUrl', () => {
  it('returns null for empty or undefined input', () => {
    expect(sanitizeDiagnosticBaseUrl(undefined)).toBeNull();
    expect(sanitizeDiagnosticBaseUrl('')).toBeNull();
  });

  it('strips query string and hash from valid URLs', () => {
    expect(sanitizeDiagnosticBaseUrl('https://api.example.com/v1?key=secret#frag')).toBe(
      'https://api.example.com/v1'
    );
  });

  it('removes trailing slash from root pathname', () => {
    expect(sanitizeDiagnosticBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
  });

  it('preserves non-root pathname', () => {
    expect(sanitizeDiagnosticBaseUrl('https://api.example.com/v1/models')).toBe(
      'https://api.example.com/v1/models'
    );
  });

  it('falls back to stripping query/hash when URL parsing fails', () => {
    expect(sanitizeDiagnosticBaseUrl('not-a-url?foo=bar#baz')).toBe('not-a-url');
  });
});
