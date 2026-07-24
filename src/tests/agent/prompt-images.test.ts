import { describe, expect, it } from 'vitest';
import { extractPromptImages } from '../../main/agent/prompt-images';

describe('prompt-images', () => {
  it('maps renderer image blocks to SDK { data, mimeType } and skips text', () => {
    const out = extractPromptImages([
      { type: 'text', text: 'regarde' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ]);
    expect(out).toEqual([{ type: 'image', data: 'AAAA', mimeType: 'image/png' }]);
  });

  it('returns [] for no images, non-array, or empty content', () => {
    expect(extractPromptImages([{ type: 'text', text: 'hi' }])).toEqual([]);
    expect(extractPromptImages(undefined)).toEqual([]);
    expect(extractPromptImages('nope')).toEqual([]);
    expect(extractPromptImages([])).toEqual([]);
  });

  it('skips malformed image blocks (missing data or media_type)', () => {
    expect(
      extractPromptImages([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } },
        { type: 'image', source: { type: 'base64', data: 'AAAA' } },
        { type: 'image' },
      ])
    ).toEqual([]);
  });

  it('keeps multiple valid images in order', () => {
    const out = extractPromptImages([
      { type: 'image', source: { media_type: 'image/png', data: 'A' } },
      { type: 'image', source: { media_type: 'image/jpeg', data: 'B' } },
    ]);
    expect(out).toEqual([
      { type: 'image', data: 'A', mimeType: 'image/png' },
      { type: 'image', data: 'B', mimeType: 'image/jpeg' },
    ]);
  });
});
