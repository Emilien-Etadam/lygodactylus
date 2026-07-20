import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SemanticIndexService } from '../../main/semantic-search/index-service';
import { resolveContainedWorkspacePath } from '../../main/tools/path-safety';
import { listIndexableWorkspaceFiles } from '../../main/semantic-search/gitignore';
import { SEMANTIC_MAX_FILE_BYTES } from '../../main/semantic-search/constants';
import type { MemoryRerankerConfig } from '../../main/config/config-schema';

const DISABLED_RERANKER: MemoryRerankerConfig = {
  enabled: false,
  baseUrl: '',
  model: '',
  topN: 20,
  keep: 8,
  timeoutMs: 800,
};

/** Deterministic bag-of-token embedding for tests (no network). */
function mockEmbed(text: string): number[] {
  const dims = 32;
  const vec = new Array<number>(dims).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i += 1) {
      hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
    }
    vec[hash % dims] += 1;
  }
  return vec;
}

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('semantic index pipeline', () => {
  const cleanupRoots: string[] = [];

  afterEach(() => {
    for (const root of cleanupRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('indexes a temp workspace and ranks natural-language queries', async () => {
    const workspace = makeTempDir('lygo-sem-ws-');
    const storage = makeTempDir('lygo-sem-store-');
    cleanupRoots.push(workspace, storage);

    fs.writeFileSync(
      path.join(workspace, 'auth.ts'),
      [
        '// authentication helpers',
        'export function loginUser() {}',
        'export function verifyToken() {}',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(workspace, 'ui.tsx'),
      ['export function Button() {', '  return <button>Click</button>;', '}'].join('\n')
    );
    fs.writeFileSync(path.join(workspace, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const service = new SemanticIndexService({
      storageRoot: storage,
      embed: async (text) => mockEmbed(text),
      getRerankerConfig: () => DISABLED_RERANKER,
      enableWatcher: false,
    });

    try {
      const hits = await service.search(workspace, 'user authentication login token', 5);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].file).toBe('auth.ts');
      expect(hits[0].line).toBeGreaterThanOrEqual(1);
      expect(hits[0].excerpt.length).toBeGreaterThan(0);
      expect(hits[0].score).toBeGreaterThan(0);

      // png must never be indexed
      expect(hits.every((hit) => hit.file !== 'photo.png')).toBe(true);
    } finally {
      service.close();
    }
  });

  it('rejects paths outside the workspace (containment)', () => {
    const workspace = makeTempDir('lygo-sem-contain-');
    const outside = makeTempDir('lygo-sem-outside-');
    cleanupRoots.push(workspace, outside);

    fs.writeFileSync(path.join(workspace, 'inside.ts'), 'export const ok = 1;\n');
    fs.writeFileSync(path.join(outside, 'secret.ts'), 'export const secret = 1;\n');

    expect(
      resolveContainedWorkspacePath(workspace, path.join(workspace, 'inside.ts'))
    ).toBeTruthy();
    expect(resolveContainedWorkspacePath(workspace, path.join(outside, 'secret.ts'))).toBeNull();
    expect(
      resolveContainedWorkspacePath(workspace, path.join(workspace, '..', 'secret.ts'))
    ).toBeNull();
    expect(
      resolveContainedWorkspacePath(
        workspace,
        path.join(workspace, 'nested', '..', '..', 'secret.ts')
      )
    ).toBeNull();
  });

  it('replaces chunks when a file is modified (incremental)', async () => {
    const workspace = makeTempDir('lygo-sem-incr-');
    const storage = makeTempDir('lygo-sem-store-incr-');
    cleanupRoots.push(workspace, storage);

    const target = path.join(workspace, 'notes.md');
    fs.writeFileSync(target, 'alpha topic about cats\n');

    const service = new SemanticIndexService({
      storageRoot: storage,
      embed: async (text) => mockEmbed(text),
      getRerankerConfig: () => DISABLED_RERANKER,
      enableWatcher: false,
    });

    try {
      await service.search(workspace, 'cats', 3);
      const before = service.getStoredExcerptsForTests(workspace, 'notes.md');
      expect(before.some((excerpt) => excerpt.includes('cats'))).toBe(true);

      fs.writeFileSync(target, 'beta topic about dogs and kennels\n');
      await service.reindexFileForTests(workspace, 'notes.md');

      const after = service.getStoredExcerptsForTests(workspace, 'notes.md');
      expect(after.some((excerpt) => excerpt.includes('dogs'))).toBe(true);
      expect(after.some((excerpt) => excerpt.includes('cats'))).toBe(false);

      const hits = await service.search(workspace, 'kennels dogs', 3);
      expect(hits[0]?.file).toBe('notes.md');
    } finally {
      service.close();
    }
  });

  it('respects .gitignore and size/extension caps during discovery', async () => {
    const workspace = makeTempDir('lygo-sem-ignore-');
    cleanupRoots.push(workspace);

    fs.writeFileSync(path.join(workspace, '.gitignore'), 'ignored/\nsecret.ts\n');
    fs.mkdirSync(path.join(workspace, 'ignored'));
    fs.writeFileSync(path.join(workspace, 'ignored', 'hidden.ts'), 'export const hidden = 1;\n');
    fs.writeFileSync(path.join(workspace, 'secret.ts'), 'export const secret = 1;\n');
    fs.writeFileSync(path.join(workspace, 'keep.ts'), 'export const keep = 1;\n');
    fs.writeFileSync(path.join(workspace, 'big.bin'), Buffer.alloc(16));
    fs.writeFileSync(
      path.join(workspace, 'huge.ts'),
      Buffer.alloc(SEMANTIC_MAX_FILE_BYTES + 8, 0x61)
    );

    const files = await listIndexableWorkspaceFiles(workspace);
    expect(files).toContain('keep.ts');
    expect(files).not.toContain('secret.ts');
    expect(files).not.toContain('ignored/hidden.ts');
    expect(files).not.toContain('big.bin');
    expect(files).not.toContain('huge.ts');
  });
});
