import { describe, expect, it } from 'vitest';
import {
  QUICK_ASK_CLIPBOARD_MAX_BYTES,
  QUICK_ASK_CLIPBOARD_TRUNCATION_MARKER,
  prepareQuickAskClipboardText,
} from '../../shared/quick-ask';

describe('prepareQuickAskClipboardText', () => {
  it('returns empty help state for blank clipboard', () => {
    expect(prepareQuickAskClipboardText('')).toEqual({
      text: '',
      truncated: false,
      empty: true,
    });
    expect(prepareQuickAskClipboardText('   \n\t  ')).toEqual({
      text: '',
      truncated: false,
      empty: true,
    });
    expect(prepareQuickAskClipboardText(null)).toEqual({
      text: '',
      truncated: false,
      empty: true,
    });
  });

  it('keeps short text unchanged', () => {
    expect(prepareQuickAskClipboardText('  hello world  ')).toEqual({
      text: 'hello world',
      truncated: false,
      empty: false,
    });
  });

  it('truncates to 32 KiB UTF-8-safe with a stable marker', () => {
    const big = 'a'.repeat(QUICK_ASK_CLIPBOARD_MAX_BYTES + 100);
    const result = prepareQuickAskClipboardText(big);
    expect(result.empty).toBe(false);
    expect(result.truncated).toBe(true);
    expect(result.text.endsWith(QUICK_ASK_CLIPBOARD_TRUNCATION_MARKER)).toBe(true);
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(
      QUICK_ASK_CLIPBOARD_MAX_BYTES
    );
  });

  it('does not split a multi-byte UTF-8 code point at the cut', () => {
    // "é" is 2 bytes in UTF-8. Build a payload that would otherwise cut mid-character.
    const prefix = 'x'.repeat(QUICK_ASK_CLIPBOARD_MAX_BYTES - 1);
    const raw = `${prefix}éeeee`;
    const result = prepareQuickAskClipboardText(raw);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(
      QUICK_ASK_CLIPBOARD_MAX_BYTES
    );
    // Round-trip must not produce a replacement character from a torn sequence.
    expect(result.text.includes('\uFFFD')).toBe(false);
    expect(result.text.endsWith(QUICK_ASK_CLIPBOARD_TRUNCATION_MARKER)).toBe(true);
  });

  it('is byte-stable for the same oversized input', () => {
    const raw = `${'é'.repeat(20_000)}tail`;
    const first = prepareQuickAskClipboardText(raw);
    const second = prepareQuickAskClipboardText(raw);
    expect(first).toEqual(second);
  });
});
