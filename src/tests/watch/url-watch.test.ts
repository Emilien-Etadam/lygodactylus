import { describe, expect, it } from 'vitest';
import {
  buildTruncatedUrlDiff,
  extractTextFromHtml,
  hashText,
} from '../../main/watch/url-watch';
import { WATCH_URL_DIFF_MAX_BYTES } from '../../shared/watch';

describe('url-watch helpers', () => {
  it('extracts readable text from HTML', () => {
    const text = extractTextFromHtml(
      '<html><head><style>.x{}</style><script>alert(1)</script></head><body><h1>Hi</h1><p>World&nbsp;!</p></body></html>'
    );
    expect(text).toContain('Hi');
    expect(text).toContain('World !');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('.x');
  });

  it('hashes text stably', () => {
    expect(hashText('same')).toBe(hashText('same'));
    expect(hashText('same')).not.toBe(hashText('other'));
  });

  it('truncates URL unified diffs to 8 KiB UTF-8-safe', () => {
    const oldText = 'line\n'.repeat(20);
    const newText = `${'changed line with unicode café 🎉\n'.repeat(4000)}${oldText}`;
    const diff = buildTruncatedUrlDiff('https://example.com/page', oldText, newText);
    expect(Buffer.byteLength(diff, 'utf8')).toBeLessThanOrEqual(WATCH_URL_DIFF_MAX_BYTES);
    expect(diff).toContain('…[truncated]');
    expect(diff).toContain('--- a/example.com/page');
  });
});
