import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const userDataRoot = path.join(
  os.tmpdir(),
  `lygodactylus-checkpoints-test-${process.pid}-${Date.now()}`
);

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataRoot;
      return path.join(os.tmpdir(), name);
    },
  },
}));

describe('checkpoint-store', () => {
  const sessionId = 'session-a';
  const runId = 'run-1';
  let workspaceRoot: string;

  beforeEach(async () => {
    vi.resetModules();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
    fs.mkdirSync(userDataRoot, { recursive: true });
    workspaceRoot = path.join(userDataRoot, 'workspace');
    fs.mkdirSync(workspaceRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  });

  async function loadStore() {
    return import('../../main/checkpoints/checkpoint-store');
  }

  it('captures a unique pre-image per file/run (modified)', async () => {
    const store = await loadStore();
    store.createRunJournal(sessionId, runId, workspaceRoot);

    const filePath = path.join(workspaceRoot, 'hello.txt');
    fs.writeFileSync(filePath, 'v1', 'utf-8');

    const first = store.captureFilePreImage({
      sessionId,
      runId,
      absolutePath: filePath,
      workspaceRoot,
      source: 'write',
    });
    expect(first.status).toBe('captured');
    if (first.status === 'captured') {
      expect(first.action).toBe('modified');
    }

    fs.writeFileSync(filePath, 'v2', 'utf-8');
    const second = store.captureFilePreImage({
      sessionId,
      runId,
      absolutePath: filePath,
      workspaceRoot,
      source: 'edit',
    });
    expect(second).toEqual({ status: 'skipped', reason: 'already-covered' });

    const summary = store.getRunSummary(sessionId, runId);
    expect(summary?.files).toHaveLength(1);
    expect(summary?.files[0]?.action).toBe('modified');
  });

  it('marks created files without pre-image and restores modified+created', async () => {
    const store = await loadStore();
    store.createRunJournal(sessionId, runId, workspaceRoot);

    const existing = path.join(workspaceRoot, 'existing.ts');
    fs.writeFileSync(existing, 'original', 'utf-8');
    store.captureFilePreImage({
      sessionId,
      runId,
      absolutePath: existing,
      workspaceRoot,
      source: 'edit',
    });
    fs.writeFileSync(existing, 'changed', 'utf-8');

    const created = path.join(workspaceRoot, 'new-file.ts');
    store.captureFilePreImage({
      sessionId,
      runId,
      absolutePath: created,
      workspaceRoot,
      source: 'write',
    });
    fs.writeFileSync(created, 'brand new', 'utf-8');

    const result = store.restoreRun(sessionId, runId);
    expect(result.ok).toBe(true);
    expect(result.restored).toContain(existing);
    expect(result.deleted).toContain(created);
    expect(fs.readFileSync(existing, 'utf-8')).toBe('original');
    expect(fs.existsSync(created)).toBe(false);
  });

  it('signals partial coverage when the byte cap is exceeded', async () => {
    const store = await loadStore();
    store.createRunJournal(sessionId, runId, workspaceRoot);

    const big = path.join(workspaceRoot, 'big.bin');
    fs.writeFileSync(big, Buffer.alloc(100));
    const first = store.captureFilePreImage({
      sessionId,
      runId,
      absolutePath: big,
      workspaceRoot,
      source: 'write',
      maxBytes: 50,
    });
    expect(first.status).toBe('partial-stop');

    const small = path.join(workspaceRoot, 'small.txt');
    fs.writeFileSync(small, 'x');
    const skipped = store.captureFilePreImage({
      sessionId,
      runId,
      absolutePath: small,
      workspaceRoot,
      source: 'write',
      maxBytes: 50,
    });
    expect(skipped).toEqual({ status: 'skipped', reason: 'partial' });

    const summary = store.getRunSummary(sessionId, runId);
    expect(summary?.partialCoverage).toBe(true);
    expect(summary?.files).toHaveLength(0);
  });

  it('purges runs beyond retention', async () => {
    const store = await loadStore();
    for (let i = 0; i < 5; i++) {
      const id = `run-${i}`;
      store.createRunJournal(sessionId, id, workspaceRoot);
      const journal = store.checkpointStorePaths.readJournal(sessionId, id);
      expect(journal).not.toBeNull();
      if (journal) {
        journal.createdAt = 1000 + i;
        store.checkpointStorePaths.writeJournal(journal);
      }
    }

    const purged = store.purgeOldRuns(sessionId, 2);
    expect(purged).toBe(3);
    const remaining = store.listSessionRunSummaries(sessionId);
    expect(remaining).toHaveLength(2);
    expect(remaining.map((r) => r.runId).sort()).toEqual(['run-3', 'run-4']);
  });

  it('refuses restore while a session run is marked active', async () => {
    const store = await loadStore();
    store.createRunJournal(sessionId, runId, workspaceRoot);
    const filePath = path.join(workspaceRoot, 'a.txt');
    fs.writeFileSync(filePath, 'a', 'utf-8');
    store.captureFilePreImage({
      sessionId,
      runId,
      absolutePath: filePath,
      workspaceRoot,
      source: 'write',
    });
    fs.writeFileSync(filePath, 'b', 'utf-8');

    const refused = store.restoreRun(sessionId, runId, {
      refuseIfActive: true,
      isSessionActive: () => true,
    });
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe('run_in_progress');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('b');

    const allowed = store.restoreRun(sessionId, runId, {
      refuseIfActive: true,
      isSessionActive: () => false,
    });
    expect(allowed.ok).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('a');
  });

  it('purges all checkpoints for a session', async () => {
    const store = await loadStore();
    store.createRunJournal(sessionId, runId, workspaceRoot);
    expect(store.listSessionRunSummaries(sessionId)).toHaveLength(1);
    store.purgeSessionCheckpoints(sessionId);
    expect(store.listSessionRunSummaries(sessionId)).toHaveLength(0);
  });
});
