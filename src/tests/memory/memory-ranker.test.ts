import { describe, expect, it } from 'vitest';
import {
  MEMORY_RANKER_CONFIG,
  computeMemoryRankScore,
  memoryFreshnessFactor,
} from '../../main/memory/memory-ranker';

const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const DAY_MS = 86_400_000;

function daysAgoIso(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

describe('memory-ranker', () => {
  it('boosts same-workspace matches', () => {
    const sameWorkspace = computeMemoryRankScore({
      query: 'gateway token',
      text: 'gateway token rotation policy',
      currentWorkspace: '/workspace/project-a',
      sourceWorkspace: '/workspace/project-a',
      ingestedAt: new Date().toISOString(),
    });
    const otherWorkspace = computeMemoryRankScore({
      query: 'gateway token',
      text: 'gateway token rotation policy',
      currentWorkspace: '/workspace/project-a',
      sourceWorkspace: '/workspace/project-b',
      ingestedAt: new Date().toISOString(),
    });
    expect(sameWorkspace.score).toBeGreaterThan(otherWorkspace.score);
  });

  it('ranks a recent memory above an older one at equal relevance', () => {
    const shared = {
      query: 'gateway token',
      text: 'gateway token rotation policy',
      currentWorkspace: '/workspace/project-a',
      sourceWorkspace: '/workspace/project-a',
      now: NOW,
    };
    const recent = computeMemoryRankScore({
      ...shared,
      ingestedAt: daysAgoIso(1),
    });
    const older = computeMemoryRankScore({
      ...shared,
      ingestedAt: daysAgoIso(60),
    });
    expect(recent.evidenceScore).toBe(older.evidenceScore);
    expect(recent.score).toBeGreaterThan(older.score);
  });

  it('applies a freshness floor so age alone cannot collapse the score', () => {
    const shared = {
      query: 'gateway token',
      text: 'gateway token rotation policy',
      currentWorkspace: '/workspace/project-a',
      sourceWorkspace: '/workspace/project-a',
      now: NOW,
    };
    // Âge > 45j : boost additif nul des deux côtés → le ratio isole le facteur fraîcheur.
    const baseline = computeMemoryRankScore(shared);
    const ancient = computeMemoryRankScore({
      ...shared,
      ingestedAt: daysAgoIso(3650),
    });
    expect(baseline.score).toBeGreaterThan(0);
    expect(ancient.score / baseline.score).toBeCloseTo(MEMORY_RANKER_CONFIG.freshnessFloor, 8);
    expect(memoryFreshnessFactor(daysAgoIso(3650), NOW)).toBe(
      MEMORY_RANKER_CONFIG.freshnessFloor
    );
  });

  it('keeps score unchanged when no timestamp is provided', () => {
    const withDefaults = computeMemoryRankScore({
      query: 'gateway token',
      text: 'gateway token rotation policy',
      currentWorkspace: '/workspace/project-a',
      sourceWorkspace: '/workspace/project-a',
      now: NOW,
    });
    // Score pré-fraîcheur : evidence + workspace boost uniquement (pas de recency additif).
    const evidenceAndWorkspace = withDefaults.evidenceScore + 0.3;
    expect(withDefaults.score).toBe(evidenceAndWorkspace);
    expect(memoryFreshnessFactor(undefined, NOW)).toBe(1);
  });

  it('halves the score when confidence is 0.5', () => {
    const shared = {
      query: 'gateway token',
      text: 'gateway token rotation policy',
      currentWorkspace: '/workspace/project-a',
      sourceWorkspace: '/workspace/project-a',
      ingestedAt: daysAgoIso(1),
      now: NOW,
    };
    const full = computeMemoryRankScore({ ...shared, confidence: 1 });
    const half = computeMemoryRankScore({ ...shared, confidence: 0.5 });
    expect(half.score).toBeCloseTo(full.score * 0.5, 8);
  });

  it('treats missing confidence as neutral (same as 1.0)', () => {
    const shared = {
      query: 'gateway token',
      text: 'gateway token rotation policy',
      currentWorkspace: '/workspace/project-a',
      sourceWorkspace: '/workspace/project-a',
      ingestedAt: daysAgoIso(1),
      now: NOW,
    };
    const absent = computeMemoryRankScore(shared);
    const explicit = computeMemoryRankScore({ ...shared, confidence: 1 });
    expect(absent.score).toBe(explicit.score);
  });
});
