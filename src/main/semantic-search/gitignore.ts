import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import ignore from 'ignore';
import { SEMANTIC_ALWAYS_IGNORE_DIR_NAMES } from './constants';
import { clampFileList, isAllowedTextFile, isWithinFileSizeLimit } from './file-filters';
import { resolveContainedWorkspacePath, toWorkspaceRelativePath } from '../tools/path-safety';

type IgnoreFilter = ReturnType<typeof ignore>;

const DEFAULT_IGNORE_PATTERNS = [
  ...SEMANTIC_ALWAYS_IGNORE_DIR_NAMES,
  ...[...SEMANTIC_ALWAYS_IGNORE_DIR_NAMES].map((name) => `**/${name}/**`),
];

function loadIgnoreFilter(workspaceRoot: string): IgnoreFilter {
  const ig = ignore();
  ig.add(DEFAULT_IGNORE_PATTERNS);

  const rootGitignore = path.join(workspaceRoot, '.gitignore');
  try {
    if (fs.existsSync(rootGitignore) && fs.statSync(rootGitignore).isFile()) {
      ig.add(fs.readFileSync(rootGitignore, 'utf8'));
    }
  } catch {
    // Missing / unreadable .gitignore → keep defaults only.
  }

  return ig;
}

/**
 * Discover indexable text files under a workspace.
 * Respects root `.gitignore` (via the existing `ignore` package) and hard caps.
 * Returns relative posix paths, discovery order, already clamped.
 */
export async function listIndexableWorkspaceFiles(
  workspaceRoot: string,
  options: { maxFiles?: number } = {}
): Promise<string[]> {
  const resolvedRoot = resolveContainedWorkspacePath(workspaceRoot, workspaceRoot);
  if (!resolvedRoot) {
    return [];
  }

  const ig = loadIgnoreFilter(resolvedRoot);
  const globIgnore = [
    ...[...SEMANTIC_ALWAYS_IGNORE_DIR_NAMES].map((name) => `**/${name}/**`),
    ...[...SEMANTIC_ALWAYS_IGNORE_DIR_NAMES].map((name) => `${name}/**`),
  ];

  let candidates: string[] = [];
  try {
    candidates = await glob('**/*', {
      cwd: resolvedRoot,
      nodir: true,
      dot: true,
      absolute: false,
      follow: false,
      ignore: globIgnore,
    });
  } catch {
    return [];
  }

  const accepted: string[] = [];
  for (const relative of candidates) {
    const posixRel = relative.split(path.sep).join('/');
    if (!posixRel || ig.ignores(posixRel)) {
      continue;
    }
    if (!isAllowedTextFile(posixRel)) {
      continue;
    }

    const absolute = resolveContainedWorkspacePath(resolvedRoot, posixRel);
    if (!absolute) {
      continue;
    }

    // Re-check relative after realpath (symlink containment).
    const safeRel = toWorkspaceRelativePath(resolvedRoot, absolute);
    if (!safeRel || !isAllowedTextFile(safeRel)) {
      continue;
    }

    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || !isWithinFileSizeLimit(stat.size)) {
        continue;
      }
    } catch {
      continue;
    }

    accepted.push(safeRel);
  }

  return clampFileList(accepted, options.maxFiles);
}

/** True when a relative path should be ignored by default/.gitignore rules. */
export function isIgnoredByGitignore(workspaceRoot: string, relativePath: string): boolean {
  const resolvedRoot = resolveContainedWorkspacePath(workspaceRoot, workspaceRoot);
  if (!resolvedRoot) {
    return true;
  }
  const posixRel = relativePath.split(path.sep).join('/');
  if (!posixRel) {
    return true;
  }
  return loadIgnoreFilter(resolvedRoot).ignores(posixRel);
}
