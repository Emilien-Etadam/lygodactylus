import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BASELINE_CACHE_POLICY,
  deleteBaseline,
  isValidFingerprint,
  listBaselineEntries,
  runBaselineGc,
  selectBaselinesToEvict,
  type BaselineEntry,
  type BaselineCachePolicy,
  type SandboxExecFn,
} from '../../main/sandbox/sandbox-baseline-cache';

const NOW = 1_000_000_000_000;
const CACHE_ROOT = '/root/.lygodactylus/sandbox-cache';
const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);

function entry(fingerprint: string, sizeBytes: number, ageMs: number): BaselineEntry {
  return {
    fingerprint,
    path: `${CACHE_ROOT}/${fingerprint}`,
    sizeBytes,
    lastUsedAtMs: NOW - ageMs,
  };
}

const UNLIMITED: BaselineCachePolicy = { maxWorkspaces: 0, maxBytes: 0, maxAgeMs: 0 };
const NONE = new Set<string>();

describe('isValidFingerprint', () => {
  it('accepts a 64-char lowercase hex string', () => {
    expect(isValidFingerprint(FP_A)).toBe(true);
  });
  it('rejects wrong length, uppercase, non-hex, and traversal', () => {
    expect(isValidFingerprint('abc')).toBe(false);
    expect(isValidFingerprint('A'.repeat(64))).toBe(false);
    expect(isValidFingerprint('g'.repeat(64))).toBe(false);
    expect(isValidFingerprint('../etc/passwd')).toBe(false);
    expect(isValidFingerprint(`${FP_A}/..`)).toBe(false);
  });
});

describe('selectBaselinesToEvict', () => {
  it('evicts nothing when empty or under all caps', () => {
    expect(selectBaselinesToEvict([], DEFAULT_BASELINE_CACHE_POLICY, NONE, NOW)).toEqual([]);
    const fresh = [entry('a', 100, 1000), entry('b', 100, 2000)];
    expect(
      selectBaselinesToEvict(fresh, { maxWorkspaces: 5, maxBytes: 1e9, maxAgeMs: 1e9 }, NONE, NOW)
    ).toEqual([]);
  });

  it('purges baselines older than maxAgeMs', () => {
    const entries = [entry('fresh', 100, 5_000), entry('stale', 100, 20_000)];
    const evicted = selectBaselinesToEvict(entries, { ...UNLIMITED, maxAgeMs: 10_000 }, NONE, NOW);
    expect(evicted.map((e) => e.fingerprint)).toEqual(['stale']);
  });

  it('never evicts a protected baseline, even when old', () => {
    const entries = [entry('stale', 100, 20_000), entry('fresh', 100, 1_000)];
    const evicted = selectBaselinesToEvict(
      entries,
      { ...UNLIMITED, maxAgeMs: 10_000 },
      new Set(['stale']),
      NOW
    );
    expect(evicted).toEqual([]);
  });

  it('evicts least-recently-used over the workspace count cap', () => {
    const entries = [
      entry('oldest', 100, 4000),
      entry('older', 100, 3000),
      entry('newer', 100, 2000),
      entry('newest', 100, 1000),
    ];
    const evicted = selectBaselinesToEvict(entries, { ...UNLIMITED, maxWorkspaces: 2 }, NONE, NOW);
    expect(evicted.map((e) => e.fingerprint).sort()).toEqual(['older', 'oldest']);
  });

  it('evicts least-recently-used over the byte cap', () => {
    const entries = [
      entry('oldest', 100, 4000),
      entry('older', 100, 3000),
      entry('newer', 100, 2000),
      entry('newest', 100, 1000),
    ];
    const evicted = selectBaselinesToEvict(entries, { ...UNLIMITED, maxBytes: 250 }, NONE, NOW);
    expect(evicted.map((e) => e.fingerprint).sort()).toEqual(['older', 'oldest']);
  });

  it('counts protected baselines toward caps but never evicts them', () => {
    const entries = [
      entry('protected', 100, 500), // newest + protected
      entry('c-old', 100, 4000),
      entry('c-mid', 100, 3000),
      entry('c-new', 100, 2000),
    ];
    const evicted = selectBaselinesToEvict(
      entries,
      { ...UNLIMITED, maxWorkspaces: 2 },
      new Set(['protected']),
      NOW
    );
    // Keep protected + 1 newest candidate → evict the 2 oldest candidates.
    expect(evicted.map((e) => e.fingerprint).sort()).toEqual(['c-mid', 'c-old']);
  });

  it('treats 0 caps as disabled', () => {
    const entries = [entry('a', 1e9, 1e9), entry('b', 1e9, 1e9), entry('c', 1e9, 1e9)];
    expect(selectBaselinesToEvict(entries, UNLIMITED, NONE, NOW)).toEqual([]);
  });

  it('does not list a baseline twice when multiple caps apply', () => {
    const entries = [entry('stale', 500, 20_000), entry('fresh', 500, 1_000)];
    const evicted = selectBaselinesToEvict(
      entries,
      { maxWorkspaces: 1, maxBytes: 100, maxAgeMs: 10_000 },
      NONE,
      NOW
    );
    const ids = evicted.map((e) => e.fingerprint);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('stale');
  });
});

function fakeExec(handlers: Array<[RegExp, string]>): { exec: SandboxExecFn; calls: string[] } {
  const calls: string[] = [];
  const exec: SandboxExecFn = async (command: string) => {
    calls.push(command);
    for (const [pattern, stdout] of handlers) {
      if (pattern.test(command)) return { stdout, stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  return { exec, calls };
}

describe('listBaselineEntries', () => {
  it('joins size + mtime by fingerprint and ignores non-hex dirs', async () => {
    const { exec } = fakeExec([
      [
        /du -sb/,
        `1024\t${CACHE_ROOT}/${FP_A}\n2048\t${CACHE_ROOT}/${FP_B}\n4096\t${CACHE_ROOT}/not-a-fingerprint`,
      ],
      [/-printf/, `${FP_A}\t1000.5\n${FP_B}\t2000\nnot-a-fingerprint\t3000`],
    ]);

    const entries = await listBaselineEntries(exec, CACHE_ROOT);
    expect(entries).toEqual([
      { fingerprint: FP_A, path: `${CACHE_ROOT}/${FP_A}`, sizeBytes: 1024, lastUsedAtMs: 1_000_500 },
      { fingerprint: FP_B, path: `${CACHE_ROOT}/${FP_B}`, sizeBytes: 2048, lastUsedAtMs: 2_000_000 },
    ]);
  });

  it('returns an empty list when the cache root is empty', async () => {
    const { exec } = fakeExec([]);
    expect(await listBaselineEntries(exec, CACHE_ROOT)).toEqual([]);
  });
});

describe('deleteBaseline', () => {
  it('refuses an invalid fingerprint without touching the VM', async () => {
    const exec = vi.fn();
    expect(await deleteBaseline(exec as unknown as SandboxExecFn, CACHE_ROOT, '../etc')).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it('refuses to delete when the real path escapes the cache root', async () => {
    const { exec, calls } = fakeExec([
      [new RegExp(`realpath '[^']*${FP_A}'`), '/etc'],
      [/realpath/, CACHE_ROOT],
    ]);
    expect(await deleteBaseline(exec, CACHE_ROOT, FP_A)).toBe(false);
    expect(calls.some((c) => /rm -rf/.test(c))).toBe(false);
  });

  it('deletes when the real path is contained in the cache root', async () => {
    const { exec, calls } = fakeExec([
      [new RegExp(`realpath '[^']*${FP_A}'`), `${CACHE_ROOT}/${FP_A}`],
      [/realpath/, CACHE_ROOT],
    ]);
    expect(await deleteBaseline(exec, CACHE_ROOT, FP_A)).toBe(true);
    expect(calls.some((c) => /rm -rf/.test(c))).toBe(true);
  });
});

describe('runBaselineGc', () => {
  it('evicts only unprotected baselines selected by policy', async () => {
    const { exec, calls } = fakeExec([
      [/du -sb/, `100\t${CACHE_ROOT}/${FP_A}\n100\t${CACHE_ROOT}/${FP_B}`],
      // FP_A is stale, FP_B is fresh.
      [/-printf/, `${FP_A}\t${(NOW - 20_000) / 1000}\n${FP_B}\t${(NOW - 1_000) / 1000}`],
      [new RegExp(`realpath '[^']*${FP_A}'`), `${CACHE_ROOT}/${FP_A}`],
      [/realpath/, CACHE_ROOT],
    ]);

    const evicted = await runBaselineGc(
      exec,
      CACHE_ROOT,
      { ...UNLIMITED, maxAgeMs: 10_000 },
      new Set([FP_B]),
      NOW
    );
    expect(evicted.map((e) => e.fingerprint)).toEqual([FP_A]);
    expect(calls.some((c) => c.includes(`rm -rf`) && c.includes(FP_A))).toBe(true);
    expect(calls.some((c) => c.includes(`rm -rf`) && c.includes(FP_B))).toBe(false);
  });
});
