import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveContainedWorkspacePath,
  toWorkspaceRelativePath,
} from '../../main/tools/path-safety';

describe('resolveContainedWorkspacePath', () => {
  it('resolves a file inside the workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'path-safety-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'a.ts'), 'ok\n', 'utf8');

    const resolved = resolveContainedWorkspacePath(root, 'src/a.ts');
    expect(resolved).toBe(path.resolve(root, 'src/a.ts'));
  });

  it('rejects lexical traversal outside the workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'path-safety-'));
    expect(resolveContainedWorkspacePath(root, '../outside.txt')).toBeNull();
  });

  it('rejects a symlink that escapes the workspace via realpath', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'path-safety-ws-'));
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'path-safety-out-'));
    const outsideFile = path.join(outsideDir, 'secret.txt');
    await writeFile(outsideFile, 'secret\n', 'utf8');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await symlink(outsideFile, path.join(root, 'src', 'leak.txt'));

    expect(resolveContainedWorkspacePath(root, 'src/leak.txt')).toBeNull();
  });

  it('returns a posix relative path for contained files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'path-safety-rel-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    const absolute = path.join(root, 'src', 'a.ts');
    await writeFile(absolute, 'ok\n', 'utf8');

    expect(toWorkspaceRelativePath(root, absolute)).toBe('src/a.ts');
  });
});
