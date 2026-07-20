/**
 * Rule-based PII scrubbing for outbound tool egress.
 *
 * Opt-in, fail-closed. Reversible tokens {{PII_n}} are held in a per-request
 * map that must never be persisted or logged.
 */

export interface PiiScrubConfig {
  /** Global switch. Off by default. */
  enabled: boolean;
  /** User-defined literals (names, addresses…) matched case-insensitively. */
  customTerms: string[];
}

export const DEFAULT_PII_SCRUB_CONFIG: PiiScrubConfig = {
  enabled: false,
  customTerms: [],
};

export const PII_TOKEN_PATTERN = /\{\{PII_(\d+)\}\}/g;

const MAX_INPUT_CHARS = 2_000_000;
const MAX_CUSTOM_TERMS = 200;
const MAX_CUSTOM_TERM_LENGTH = 200;

export class PiiScrubError extends Error {
  readonly code = 'PII_SCRUB_FAILED' as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'PiiScrubError';
  }
}

export interface PiiMatch {
  start: number;
  end: number;
  value: string;
  kind: 'email' | 'phone' | 'iban' | 'card' | 'custom';
}

export interface PiiScrubResult {
  text: string;
  maskedCount: number;
}

export interface PiiScrubSession {
  readonly maskedCount: number;
  scrubText(text: string): string;
  unscrubText(text: string): string;
  scrubUrl(url: string): string;
  scrubHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined;
  scrubJsonValue<T>(value: T): T;
  getTokenMap(): ReadonlyMap<string, string>;
}

export function normalizePiiScrubConfig(raw: unknown): PiiScrubConfig {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const enabled = value.enabled === true;
  const termsRaw = Array.isArray(value.customTerms) ? value.customTerms : [];
  const customTerms: string[] = [];
  const seen = new Set<string>();

  for (const term of termsRaw) {
    if (typeof term !== 'string') continue;
    const trimmed = term.trim();
    if (!trimmed || trimmed.length > MAX_CUSTOM_TERM_LENGTH) continue;
    const key = trimmed.toLocaleLowerCase('fr-FR');
    if (seen.has(key)) continue;
    seen.add(key);
    customTerms.push(trimmed);
    if (customTerms.length >= MAX_CUSTOM_TERMS) break;
  }

  return { enabled, customTerms };
}

export function createPiiScrubSession(config: PiiScrubConfig): PiiScrubSession {
  const tokenToValue = new Map<string, string>();
  const valueToToken = new Map<string, string>();
  let nextIndex = 1;
  let maskedCount = 0;

  const allocateToken = (value: string): string => {
    const existing = valueToToken.get(value);
    if (existing) {
      return existing;
    }
    const token = `{{PII_${nextIndex}}}`;
    nextIndex += 1;
    valueToToken.set(value, token);
    tokenToValue.set(token, value);
    maskedCount += 1;
    return token;
  };

  const scrubText = (text: string): string => {
    assertSafeInput(text);
    const matches = findPiiMatches(text, config.customTerms);
    if (matches.length === 0) {
      return text;
    }

    let result = '';
    let cursor = 0;
    for (const match of matches) {
      result += text.slice(cursor, match.start);
      result += allocateToken(match.value);
      cursor = match.end;
    }
    result += text.slice(cursor);
    return result;
  };

  const unscrubText = (text: string): string => {
    assertSafeInput(text);
    if (tokenToValue.size === 0) {
      return text;
    }
    let restored = text.replace(PII_TOKEN_PATTERN, (token) => tokenToValue.get(token) ?? token);
    // Outbound URL query values are percent-encoded; restore echoed tokens too.
    for (const [token, value] of tokenToValue) {
      const encoded = encodeURIComponent(token);
      if (encoded !== token && restored.includes(encoded)) {
        restored = restored.split(encoded).join(value);
      }
    }
    return restored;
  };

  const scrubUrl = (url: string): string => {
    assertSafeInput(url);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      // Not a parseable absolute URL — scrub as plain text (query-less body-like).
      return scrubText(url);
    }

    // Hostname and pathname stay intact so the request remains valid.
    const params = new URLSearchParams(parsed.search);
    let changed = false;
    for (const [key, value] of [...params.entries()]) {
      const scrubbed = scrubText(value);
      if (scrubbed !== value) {
        params.set(key, scrubbed);
        changed = true;
      }
    }
    if (changed) {
      const query = params.toString();
      parsed.search = query ? `?${query}` : '';
    }
    return parsed.toString();
  };

  const scrubHeaders = (
    headers: Record<string, string> | undefined
  ): Record<string, string> | undefined => {
    if (!headers) {
      return undefined;
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      out[key] = scrubText(value);
    }
    return out;
  };

  const scrubJsonValue = <T>(value: T): T => {
    return scrubUnknown(value, scrubText) as T;
  };

  return {
    get maskedCount() {
      return maskedCount;
    },
    scrubText,
    unscrubText,
    scrubUrl,
    scrubHeaders,
    scrubJsonValue,
    getTokenMap() {
      return tokenToValue;
    },
  };
}

/**
 * Fail-closed entry points: any unexpected detector failure becomes PiiScrubError.
 * Callers must block the outbound request when this is thrown.
 */
export function scrubTextOrThrow(
  text: string,
  session: PiiScrubSession
): string {
  try {
    return session.scrubText(text);
  } catch (error) {
    if (error instanceof PiiScrubError) {
      throw error;
    }
    throw new PiiScrubError('PII scrub failed', { cause: error });
  }
}

export function unscrubTextOrThrow(text: string, session: PiiScrubSession): string {
  try {
    return session.unscrubText(text);
  } catch (error) {
    if (error instanceof PiiScrubError) {
      throw error;
    }
    throw new PiiScrubError('PII unscrub failed', { cause: error });
  }
}

export function findPiiMatches(text: string, customTerms: string[] = []): PiiMatch[] {
  assertSafeInput(text);
  const candidates: PiiMatch[] = [];

  collectEmailMatches(text, candidates);
  collectIbanMatches(text, candidates);
  collectCardMatches(text, candidates);
  collectPhoneMatches(text, candidates);
  collectCustomTermMatches(text, customTerms, candidates);

  return selectNonOverlappingMatches(candidates);
}

export function isValidIban(ibanRaw: string): boolean {
  const iban = ibanRaw.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
    return false;
  }
  // Country-specific length checks for common EU countries (FR=27).
  const lengths: Record<string, number> = {
    FR: 27,
    DE: 22,
    ES: 24,
    IT: 27,
    BE: 16,
    NL: 18,
    PT: 25,
    GB: 22,
    CH: 21,
    LU: 20,
    AT: 20,
    IE: 22,
    PL: 28,
    RO: 24,
    SE: 24,
    NO: 15,
    DK: 18,
    FI: 18,
  };
  const country = iban.slice(0, 2);
  const expected = lengths[country];
  if (expected !== undefined && iban.length !== expected) {
    return false;
  }
  if (iban.length < 15 || iban.length > 34) {
    return false;
  }

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let expanded = '';
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      expanded += String(code - 55);
    } else {
      expanded += char;
    }
  }

  return mod97(expanded) === 1;
}

export function isValidLuhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) {
    return false;
  }
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (alternate) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function assertSafeInput(text: string): void {
  if (typeof text !== 'string') {
    throw new PiiScrubError('PII scrub input must be a string');
  }
  if (text.length > MAX_INPUT_CHARS) {
    throw new PiiScrubError('PII scrub input exceeds size limit');
  }
}

function scrubUnknown(value: unknown, scrubText: (text: string) => string): unknown {
  if (typeof value === 'string') {
    return scrubText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubUnknown(item, scrubText));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = scrubUnknown(nested, scrubText);
    }
    return out;
  }
  return value;
}

function collectEmailMatches(text: string, out: PiiMatch[]): void {
  // Flat regex — no nested quantifiers.
  const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  for (const match of text.matchAll(re)) {
    const value = match[0];
    const start = match.index ?? -1;
    if (start < 0) continue;
    out.push({ start, end: start + value.length, value, kind: 'email' });
  }
}

function collectIbanMatches(text: string, out: PiiMatch[]): void {
  // Prefer grouped (spaced) form first so we do not swallow following words
  // via a greedy per-character quantifier.
  const patterns = [
    /\b[A-Z]{2}\d{2}(?:[ \t-][A-Z0-9]{4}){2,7}(?:[ \t-][A-Z0-9]{1,4})?\b/gi,
    /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi,
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const value = match[0];
      if (!isValidIban(value)) {
        continue;
      }
      const start = match.index ?? -1;
      if (start < 0) continue;
      out.push({ start, end: start + value.length, value, kind: 'iban' });
    }
  }
}

function collectCardMatches(text: string, out: PiiMatch[]): void {
  // Groups of 4 digits separated by space/dash, or a compact 13–19 digit run
  // bounded so version numbers / short IDs are less likely to match.
  const re = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
  for (const match of text.matchAll(re)) {
    const value = match[0];
    const digits = value.replace(/[ -]/g, '');
    if (!isValidLuhn(digits)) {
      continue;
    }
    // Require either separators or a typical card length to cut false positives.
    const hasSeparator = /[ -]/.test(value);
    if (!hasSeparator && (digits.length < 15 || digits.length > 16)) {
      continue;
    }
    const start = match.index ?? -1;
    if (start < 0) continue;
    out.push({ start, end: start + value.length, value, kind: 'card' });
  }
}

function collectPhoneMatches(text: string, out: PiiMatch[]): void {
  // French national / international and generic E.164. Avoid bare dotted
  // version numbers (1.2.3) by requiring +, spaces, dots-in-phone groups, or
  // a leading 0 with enough digits.
  const patterns: RegExp[] = [
    // +33 / 0033 French
    /(?:\+|00)33[\s.-]?[1-9](?:[\s.-]?\d{2}){4}\b/g,
    // National FR: 0X XX XX XX XX (spaces/dots/dashes optional)
    /\b0[1-9](?:[\s.-]?\d{2}){4}\b/g,
    // Generic E.164: +[1-9] followed by 6–14 digits (optional separators)
    /\+[1-9](?:[\s.-]?\d){6,14}\b/g,
  ];

  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const value = match[0];
      if (!looksLikePhone(value)) {
        continue;
      }
      const start = match.index ?? -1;
      if (start < 0) continue;
      out.push({ start, end: start + value.length, value, kind: 'phone' });
    }
  }
}

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    return false;
  }
  // Reject sequences that look like dotted versions already excluded by regex,
  // and reject pure digit runs that are too short for E.164 without +.
  if (!value.includes('+') && !/^0/.test(value.trim()) && !/00/.test(value)) {
    return false;
  }
  // French mobile/landline: 10 digits starting with 0, or 11 with 33.
  if (/^0[1-9]\d{8}$/.test(digits)) {
    return true;
  }
  if (/^33[1-9]\d{8}$/.test(digits)) {
    return true;
  }
  // Other E.164
  return value.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15;
}

function collectCustomTermMatches(
  text: string,
  customTerms: string[],
  out: PiiMatch[]
): void {
  for (const term of customTerms) {
    if (!term || term.length > MAX_CUSTOM_TERM_LENGTH) {
      continue;
    }
    const escaped = escapeRegExp(term);
    // Literal match, case-insensitive. No word boundary so addresses work.
    const re = new RegExp(escaped, 'gi');
    for (const match of text.matchAll(re)) {
      const value = match[0];
      const start = match.index ?? -1;
      if (start < 0) continue;
      out.push({ start, end: start + value.length, value, kind: 'custom' });
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selectNonOverlappingMatches(candidates: PiiMatch[]): PiiMatch[] {
  if (candidates.length === 0) {
    return [];
  }

  const priority: Record<PiiMatch['kind'], number> = {
    custom: 5,
    iban: 4,
    card: 3,
    email: 2,
    phone: 1,
  };

  const sorted = [...candidates].sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    const lengthDiff = b.end - b.start - (a.end - a.start);
    if (lengthDiff !== 0) {
      return lengthDiff;
    }
    return priority[b.kind] - priority[a.kind];
  });

  const selected: PiiMatch[] = [];
  let lastEnd = -1;
  for (const match of sorted) {
    if (match.start < lastEnd) {
      continue;
    }
    selected.push(match);
    lastEnd = match.end;
  }
  return selected;
}

function mod97(numeric: string): number {
  let remainder = 0;
  for (const char of numeric) {
    const digit = char.charCodeAt(0) - 48;
    if (digit < 0 || digit > 9) {
      throw new PiiScrubError('Invalid IBAN digit during mod-97');
    }
    remainder = (remainder * 10 + digit) % 97;
  }
  return remainder;
}
