import { describe, expect, it } from 'vitest';
import {
  filterWorkspacePathSuggestions,
  formatAttachedContextBlock,
  getAtMentionQuery,
  isAtMentionUrlQuery,
  parseAtMentions,
  scoreWorkspacePathQuery,
} from '../../shared/at-mentions';

describe('parseAtMentions', () => {
  it('parses multiple path mentions', () => {
    const mentions = parseAtMentions('See @src/a.ts and @docs/readme.md please');
    expect(mentions.map((m) => m.value)).toEqual(['src/a.ts', 'docs/readme.md']);
    expect(mentions.every((m) => m.kind === 'path')).toBe(true);
  });

  it('parses adjacent mentions separated only by @', () => {
    const mentions = parseAtMentions('@src/a.ts@src/b.ts');
    expect(mentions.map((m) => m.value)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('ignores escaped \\@ mentions', () => {
    const mentions = parseAtMentions('keep \\@literal and use @real/file.ts');
    expect(mentions.map((m) => m.value)).toEqual(['real/file.ts']);
  });

  it('does not treat email-like tokens as mentions', () => {
    expect(parseAtMentions('contact user@example.com')).toEqual([]);
  });

  it('detects URL mentions after @', () => {
    const mentions = parseAtMentions('Fetch @https://example.com/docs and @src/x.ts');
    expect(mentions).toEqual([
      expect.objectContaining({
        value: 'https://example.com/docs',
        kind: 'url',
      }),
      expect.objectContaining({
        value: 'src/x.ts',
        kind: 'path',
      }),
    ]);
  });

  it('strips trailing sentence punctuation from path mentions', () => {
    const mentions = parseAtMentions('Open @src/foo.ts.');
    expect(mentions.map((m) => m.value)).toEqual(['src/foo.ts']);
  });
});

describe('getAtMentionQuery', () => {
  it('returns null outside an active mention', () => {
    expect(getAtMentionQuery('hello')).toBeNull();
    expect(getAtMentionQuery('hello @src/foo.ts more')).toBeNull();
  });

  it('returns the query being typed after @', () => {
    expect(getAtMentionQuery('@')).toBe('');
    expect(getAtMentionQuery('see @src/fo')).toBe('src/fo');
    expect(getAtMentionQuery('(@path')).toBe('path');
  });
});

describe('URL query helpers', () => {
  it('detects full and partial URL queries', () => {
    expect(isAtMentionUrlQuery('https://example.com')).toBe(true);
    expect(isAtMentionUrlQuery('http')).toBe(true);
    expect(isAtMentionUrlQuery('src/foo.ts')).toBe(false);
  });
});

describe('fuzzy path scoring', () => {
  it('ranks basename prefix matches above deep substring matches', () => {
    const basename = scoreWorkspacePathQuery('src/foo.ts', 'foo');
    const deep = scoreWorkspacePathQuery('vendor/other/foo-utils/index.ts', 'foo');
    expect(basename).toBeGreaterThan(deep);
  });

  it('filters and limits suggestions', () => {
    const entries = [
      { relativePath: 'src/a.ts', kind: 'file' as const },
      { relativePath: 'src/app', kind: 'directory' as const },
      { relativePath: 'docs/a.md', kind: 'file' as const },
    ];
    const filtered = filterWorkspacePathSuggestions(entries, 'src/a', 20);
    expect(filtered.map((e) => e.relativePath)).toContain('src/a.ts');
    expect(filtered.map((e) => e.relativePath)).toContain('src/app');
  });
});

describe('formatAttachedContextBlock', () => {
  it('escapes source attribute values', () => {
    expect(formatAttachedContextBlock('a"b', 'body')).toContain('source="a&quot;b"');
  });
});
