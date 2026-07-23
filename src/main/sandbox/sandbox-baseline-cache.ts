/**
 * @module main/sandbox/sandbox-baseline-cache
 *
 * Per-workspace baseline cache for the isolated sandbox VM.
 *
 * Seeding a new session by rsyncing the whole workspace across the host↔VM
 * boundary (drvfs on WSL, virtiofs on Lima) is slow. Instead we keep a
 * per-workspace *baseline* inside the VM, refresh it with a delta sync, and
 * clone it into the per-session dir with a fast VM-local copy. The per-session
 * dir stays the isolated execution root — this only changes how it is seeded,
 * never the isolation model.
 *
 * The GC selector is pure and injection-free so it can be unit-tested in full;
 * all VM I/O goes through an injected executor so this module never hard-depends
 * on `wsl`/`limactl`.
 */

/** Executor abstraction so this module is VM-agnostic (WSL / Lima) and testable. */
export type SandboxExecFn = (
  command: string,
  timeoutMs?: number
) => Promise<{ stdout: string; stderr: string }>;

export interface BaselineCachePolicy {
  /** Max number of baselines to keep (0 = unlimited). */
  maxWorkspaces: number;
  /** Max total bytes across all baselines (0 = unlimited). */
  maxBytes: number;
  /** Evict baselines unused longer than this (ms; 0 = never by age). */
  maxAgeMs: number;
}

export const DEFAULT_BASELINE_CACHE_POLICY: BaselineCachePolicy = {
  maxWorkspaces: 5,
  maxBytes: 5 * 1024 * 1024 * 1024, // 5 GiB
  maxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
};

export interface BaselineEntry {
  fingerprint: string;
  path: string;
  sizeBytes: number;
  lastUsedAtMs: number;
}

/** Workspace fingerprints are sha256 hex — validate before any shell use. */
export function isValidFingerprint(fingerprint: string): boolean {
  return /^[a-f0-9]{64}$/.test(fingerprint);
}

/**
 * Decide which baselines to evict. Pure and deterministic (time injected).
 *
 * Order:
 *  1. never evict a protected (currently-referenced by a live session) baseline;
 *  2. evict anything unused longer than maxAgeMs;
 *  3. while kept count > maxWorkspaces, evict least-recently-used;
 *  4. while kept bytes > maxBytes, evict least-recently-used.
 *
 * Protected baselines still count toward the caps (they occupy real space) but
 * are never selected — if protected alone exceeds a cap we simply keep them.
 */
export function selectBaselinesToEvict(
  entries: readonly BaselineEntry[],
  policy: BaselineCachePolicy,
  protectedFingerprints: ReadonlySet<string>,
  nowMs: number
): BaselineEntry[] {
  const evicted = new Set<string>();
  const evict: BaselineEntry[] = [];
  const markEvict = (entry: BaselineEntry) => {
    if (!evicted.has(entry.fingerprint)) {
      evicted.add(entry.fingerprint);
      evict.push(entry);
    }
  };

  const candidates = entries.filter((entry) => !protectedFingerprints.has(entry.fingerprint));

  // 2) Age-based purge.
  if (policy.maxAgeMs > 0) {
    for (const entry of candidates) {
      if (nowMs - entry.lastUsedAtMs > policy.maxAgeMs) {
        markEvict(entry);
      }
    }
  }

  // Oldest-first survivors among the candidates we may still touch.
  const survivorsOldestFirst = (): BaselineEntry[] =>
    candidates
      .filter((entry) => !evicted.has(entry.fingerprint))
      .sort((a, b) => a.lastUsedAtMs - b.lastUsedAtMs);

  const protectedEntries = entries.filter((entry) =>
    protectedFingerprints.has(entry.fingerprint)
  );
  const protectedCount = protectedEntries.length;
  const protectedBytes = protectedEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0);

  // 3) Count cap (LRU).
  if (policy.maxWorkspaces > 0) {
    const survivors = survivorsOldestFirst();
    let kept = protectedCount + survivors.length;
    for (const entry of survivors) {
      if (kept <= policy.maxWorkspaces) break;
      markEvict(entry);
      kept -= 1;
    }
  }

  // 4) Size cap (LRU).
  if (policy.maxBytes > 0) {
    const survivors = survivorsOldestFirst();
    let bytes = protectedBytes + survivors.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    for (const entry of survivors) {
      if (bytes <= policy.maxBytes) break;
      markEvict(entry);
      bytes -= entry.sizeBytes;
    }
  }

  return evict;
}

/** POSIX single-quote escaping (content only, no surrounding quotes). */
function shellEscape(value: string): string {
  return value.replace(/'/g, "'\\''");
}

/**
 * List baselines under a cache root: one call for sizes, one for name+mtime.
 * Entries with a non-hex directory name are ignored (never trusted in shell).
 */
export async function listBaselineEntries(
  exec: SandboxExecFn,
  cacheRoot: string
): Promise<BaselineEntry[]> {
  const root = shellEscape(cacheRoot);
  // Sizes: "bytes\t/abs/path" per dir (no output when the root is empty/missing).
  const sizeOut = await exec(
    `find '${root}' -mindepth 1 -maxdepth 1 -type d -exec du -sb {} + 2>/dev/null || true`,
    120000
  );
  // mtimes: "name\tepochSeconds" per dir.
  const mtimeOut = await exec(
    `find '${root}' -mindepth 1 -maxdepth 1 -type d -printf '%f\\t%T@\\n' 2>/dev/null || true`,
    60000
  );

  const sizeByFingerprint = new Map<string, number>();
  for (const line of sizeOut.stdout.split(/\r?\n/)) {
    const match = /^(\d+)\t(.+)$/.exec(line.trim());
    if (!match) continue;
    const fingerprint = match[2].split('/').pop() ?? '';
    if (isValidFingerprint(fingerprint)) {
      sizeByFingerprint.set(fingerprint, Number.parseInt(match[1], 10) || 0);
    }
  }

  const entries: BaselineEntry[] = [];
  for (const line of mtimeOut.stdout.split(/\r?\n/)) {
    const match = /^([^\t]+)\t([\d.]+)$/.exec(line.trim());
    if (!match) continue;
    const fingerprint = match[1];
    if (!isValidFingerprint(fingerprint)) continue;
    const mtimeSeconds = Number.parseFloat(match[2]);
    entries.push({
      fingerprint,
      path: `${cacheRoot}/${fingerprint}`,
      sizeBytes: sizeByFingerprint.get(fingerprint) ?? 0,
      lastUsedAtMs: Number.isFinite(mtimeSeconds) ? Math.floor(mtimeSeconds * 1000) : 0,
    });
  }
  return entries;
}

/**
 * Delete a baseline, guarding against traversal/symlink escapes: the real path
 * must resolve inside the cache root and the name must be a valid fingerprint.
 */
export async function deleteBaseline(
  exec: SandboxExecFn,
  cacheRoot: string,
  fingerprint: string
): Promise<boolean> {
  if (!isValidFingerprint(fingerprint)) {
    return false;
  }
  const baselinePath = `${cacheRoot}/${fingerprint}`;
  try {
    const realResult = await exec(
      `realpath '${shellEscape(baselinePath)}' 2>/dev/null || true`,
      30000
    );
    const realPath = realResult.stdout.trim();
    const rootReal = await exec(`realpath '${shellEscape(cacheRoot)}' 2>/dev/null || true`, 30000);
    const cacheRootReal = rootReal.stdout.trim();
    if (!realPath || !cacheRootReal || !realPath.startsWith(cacheRootReal + '/')) {
      return false;
    }
    await exec(`rm -rf '${shellEscape(baselinePath)}'`, 120000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run baseline GC: list, select, delete. Never evicts a protected baseline.
 * Failures are swallowed by the caller — GC must never break a run.
 */
export async function runBaselineGc(
  exec: SandboxExecFn,
  cacheRoot: string,
  policy: BaselineCachePolicy,
  protectedFingerprints: ReadonlySet<string>,
  nowMs: number
): Promise<BaselineEntry[]> {
  const entries = await listBaselineEntries(exec, cacheRoot);
  const toEvict = selectBaselinesToEvict(entries, policy, protectedFingerprints, nowMs);
  const evicted: BaselineEntry[] = [];
  for (const entry of toEvict) {
    if (await deleteBaseline(exec, cacheRoot, entry.fingerprint)) {
      evicted.push(entry);
    }
  }
  return evicted;
}
