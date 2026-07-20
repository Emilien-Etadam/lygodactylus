import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import {
  filterWorkspacePathSuggestions,
  type WorkspacePathSuggestion,
} from '../../shared/at-mentions';

const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  '.cowork-user-data',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.turbo',
  'dist',
  'dist-electron',
  'release',
  '.tmp',
]);

const EXCLUDED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized']);

/** Soft cap to keep autocomplete scans responsive on large trees. */
const MAX_ENTRIES_SCANNED = 8_000;

export async function searchWorkspacePaths(
  rootDir: string,
  query: string,
  limit = 20
): Promise<WorkspacePathSuggestion[]> {
  const root = path.resolve(rootDir);
  const entries = await collectWorkspacePathEntries(root);
  return filterWorkspacePathSuggestions(entries, query, limit);
}

async function collectWorkspacePathEntries(rootDir: string): Promise<WorkspacePathSuggestion[]> {
  const results: WorkspacePathSuggestion[] = [];
  const queue = [rootDir];

  while (queue.length > 0 && results.length < MAX_ENTRIES_SCANNED) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }

    let dirents: Dirent[] = [];
    try {
      dirents = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    // Stable, predictable order for empty-query browsing.
    dirents.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of dirents) {
      if (results.length >= MAX_ENTRIES_SCANNED) {
        break;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      const relativePath = toPosixRelative(rootDir, fullPath);
      if (!relativePath || relativePath === '.') {
        continue;
      }

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }
        results.push({ relativePath, kind: 'directory' });
        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }
      if (EXCLUDED_FILES.has(entry.name)) {
        continue;
      }
      results.push({ relativePath, kind: 'file' });
    }
  }

  return results;
}

function toPosixRelative(rootDir: string, absolutePath: string): string {
  const relative = path.relative(rootDir, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return '';
  }
  return relative.split(path.sep).join('/');
}
