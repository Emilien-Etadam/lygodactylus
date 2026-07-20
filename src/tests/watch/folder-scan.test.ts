import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  diffFolderSnapshots,
  hasFolderChanges,
  scanFolderSnapshot,
} from '../../main/watch/folder-scan';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lygo-watch-'));
  tempDirs.push(dir);
  return dir;
}

describe('diffFolderSnapshots', () => {
  it('detects added, modified, and deleted files', () => {
    const previous = {
      '/a.txt': 100,
      '/b.txt': 200,
      '/c.txt': 300,
    };
    const current = {
      '/a.txt': 100,
      '/b.txt': 250,
      '/d.txt': 400,
    };
    const changes = diffFolderSnapshots(previous, current);
    expect(changes.added).toEqual(['/d.txt']);
    expect(changes.modified).toEqual(['/b.txt']);
    expect(changes.deleted).toEqual(['/c.txt']);
    expect(hasFolderChanges(changes)).toBe(true);
  });

  it('reports no changes when snapshots match', () => {
    const files = { '/a.txt': 1 };
    expect(hasFolderChanges(diffFolderSnapshots(files, { ...files }))).toBe(false);
  });
});

describe('scanFolderSnapshot', () => {
  it('scans files with mtimes via a one-shot chokidar pass', async () => {
    const dir = makeTempDir();
    const fileA = path.join(dir, 'a.txt');
    const fileB = path.join(dir, 'sub', 'b.txt');
    fs.mkdirSync(path.dirname(fileB), { recursive: true });
    fs.writeFileSync(fileA, 'a');
    fs.writeFileSync(fileB, 'b');

    const snapshot = await scanFolderSnapshot(dir);
    expect(snapshot.files[fileA]).toEqual(expect.any(Number));
    expect(snapshot.files[fileB]).toEqual(expect.any(Number));

    const afterAdd = { ...snapshot.files };
    const fileC = path.join(dir, 'c.txt');
    fs.writeFileSync(fileC, 'c');
    // Bump mtime of a
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(fileA, future, future);
    fs.unlinkSync(fileB);

    const next = await scanFolderSnapshot(dir);
    const changes = diffFolderSnapshots(afterAdd, next.files);
    expect(changes.added).toContain(fileC);
    expect(changes.modified).toContain(fileA);
    expect(changes.deleted).toContain(fileB);
  });
});
