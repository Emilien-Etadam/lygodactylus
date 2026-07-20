import { describe, expect, it } from 'vitest';
import { createUnifiedDiff, truncateUtf8 } from '../../main/autonomy/unified-diff';

describe('createUnifiedDiff', () => {
  it('produces a unified diff for a simple line change', () => {
    const diff = createUnifiedDiff('f.ts', 'a\nb\nc\n', 'a\nB\nc\n');
    expect(diff).toContain('--- a/f.ts');
    expect(diff).toContain('+++ b/f.ts');
    expect(diff).toContain('-b');
    expect(diff).toContain('+B');
  });

  it('handles new file (empty old content)', () => {
    const diff = createUnifiedDiff('new.ts', '', 'hello\n');
    expect(diff).toContain('+hello');
  });
});

describe('truncateUtf8', () => {
  it('leaves short strings unchanged', () => {
    expect(truncateUtf8('abc', 100)).toBe('abc');
  });

  it('respects byte budget with multibyte characters', () => {
    const text = 'é'.repeat(100);
    const out = truncateUtf8(text, 20);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(20);
  });
});
