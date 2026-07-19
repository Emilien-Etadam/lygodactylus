import { describe, expect, it } from 'vitest';
import { toSpeakableText } from '../../renderer/utils/speakable-text';

describe('toSpeakableText', () => {
  it('removes fenced code blocks', () => {
    const input = ['Intro', '```ts', 'const x = 1;', '```', 'Outro'].join('\n');
    expect(toSpeakableText(input)).toBe('Intro\n\nOutro');
  });

  it('keeps markdown link label and drops the URL', () => {
    expect(toSpeakableText('See [the docs](https://example.com/path) please.')).toBe(
      'See the docs please.'
    );
  });

  it('removes inline KaTeX formulas', () => {
    expect(toSpeakableText('Area is $x^2$ square meters.')).toBe('Area is square meters.');
  });

  it('leaves plain text unchanged', () => {
    expect(toSpeakableText('The capital of France is Paris.')).toBe(
      'The capital of France is Paris.'
    );
  });

  it('removes markdown tables and raw URLs', () => {
    const input = [
      'Summary',
      '| Name | Value |',
      '| --- | --- |',
      '| A | 1 |',
      'More at https://example.com/raw',
    ].join('\n');
    expect(toSpeakableText(input)).toBe('Summary\n\nMore at');
  });
});
