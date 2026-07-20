import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hashDirectoryContents } from '../../main/catalog/skill-content-hash';

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const absolute = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf8');
  }
}

describe('hashDirectoryContents', () => {
  it('is deterministic regardless of file creation order', () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-hash-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-hash-b-'));

    writeTree(dirA, {
      'SKILL.md': 'name: demo\n',
      'scripts/run.sh': 'echo hi\n',
      'nested/a.txt': 'alpha\n',
    });

    // Same content, different write order (and directory creation order).
    writeTree(dirB, {
      'nested/a.txt': 'alpha\n',
      'SKILL.md': 'name: demo\n',
      'scripts/run.sh': 'echo hi\n',
    });

    expect(hashDirectoryContents(dirA)).toBe(hashDirectoryContents(dirB));
  });

  it('changes when file content changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-hash-mod-'));
    writeTree(dir, {
      'SKILL.md': 'name: demo\n',
      'scripts/run.sh': 'echo hi\n',
    });
    const original = hashDirectoryContents(dir);

    fs.writeFileSync(path.join(dir, 'scripts', 'run.sh'), 'echo pwned\n', 'utf8');
    expect(hashDirectoryContents(dir)).not.toBe(original);
  });

  it('changes when a file path changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-hash-path-'));
    writeTree(dir, {
      'SKILL.md': 'name: demo\n',
      'a.txt': 'same\n',
    });
    const original = hashDirectoryContents(dir);

    fs.renameSync(path.join(dir, 'a.txt'), path.join(dir, 'b.txt'));
    expect(hashDirectoryContents(dir)).not.toBe(original);
  });
});
