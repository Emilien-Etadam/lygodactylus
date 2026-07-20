import { describe, expect, it } from 'vitest';

import {
  computeTokensPerSecond,
  computeTokensPerSecondFromText,
  estimateTokensFromText,
  formatTokensPerSecond,
  type StreamTokenSample,
} from '../src/renderer/utils/generation-stats';
import { formatContextPercentage } from '../src/renderer/utils/context-usage';

describe('estimateTokensFromText', () => {
  it('matches the chars/4 heuristic', () => {
    expect(estimateTokensFromText('')).toBe(0);
    expect(estimateTokensFromText('abcd')).toBe(1);
    expect(estimateTokensFromText('abcde')).toBe(2);
  });
});

describe('computeTokensPerSecond', () => {
  it('returns the expected rate from simulated deltas', () => {
    // 400 chars → 100 tokens over 2 seconds → 50 tok/s
    const samples: StreamTokenSample[] = [
      { at: 1_000, cumulativeChars: 0 },
      { at: 1_500, cumulativeChars: 200 },
      { at: 3_000, cumulativeChars: 400 },
    ];
    expect(computeTokensPerSecond(samples)).toBe(50);
  });

  it('returns 0 when no tokens were generated', () => {
    const samples: StreamTokenSample[] = [
      { at: 1_000, cumulativeChars: 0 },
      { at: 2_000, cumulativeChars: 0 },
    ];
    expect(computeTokensPerSecond(samples)).toBe(0);
  });

  it('returns null for a unique burst (zero elapsed)', () => {
    const samples: StreamTokenSample[] = [{ at: 5_000, cumulativeChars: 400 }];
    expect(computeTokensPerSecond(samples)).toBeNull();

    const sameTimestamp: StreamTokenSample[] = [
      { at: 5_000, cumulativeChars: 0 },
      { at: 5_000, cumulativeChars: 400 },
    ];
    expect(computeTokensPerSecond(sameTimestamp)).toBeNull();
  });

  it('returns null for an empty sample list', () => {
    expect(computeTokensPerSecond([])).toBeNull();
  });

  it('computeTokensPerSecondFromText matches sample-based calculation', () => {
    const text = 'x'.repeat(400);
    expect(computeTokensPerSecondFromText(text, 0, 2000)).toBe(50);
  });
});

describe('formatTokensPerSecond', () => {
  it('formats rates for discreet display', () => {
    expect(formatTokensPerSecond(12.345)).toBe('12.3');
    expect(formatTokensPerSecond(9.876)).toBe('9.88');
    expect(formatTokensPerSecond(150.4)).toBe('150');
  });
});

describe('formatContextPercentage', () => {
  it('rounds and clamps with a percent suffix', () => {
    expect(formatContextPercentage(3.2)).toBe('3%');
    expect(formatContextPercentage(42.6)).toBe('43%');
    expect(formatContextPercentage(0)).toBe('0%');
    expect(formatContextPercentage(100)).toBe('100%');
    expect(formatContextPercentage(150)).toBe('100%');
    expect(formatContextPercentage(-5)).toBe('0%');
    expect(formatContextPercentage(Number.NaN)).toBe('0%');
  });
});
