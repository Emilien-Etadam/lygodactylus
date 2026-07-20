import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Deterministic sha256 of a directory's file contents.
 * Files are sorted by relative posix path; each entry contributes
 * `path + NUL + content + NUL` so permutation of walk order cannot change the digest.
 */
export function hashDirectoryContents(rootDir: string): string {
  const hash = createHash('sha256');
  for (const relPath of listFilesSorted(rootDir)) {
    const absolutePath = path.join(rootDir, ...relPath.split('/'));
    const content = fs.readFileSync(absolutePath);
    hash.update(relPath);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function listFilesSorted(rootDir: string): string[] {
  const files: string[] = [];

  const walk = (absoluteDir: string, relativeDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  };

  walk(rootDir, '');
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return files;
}
