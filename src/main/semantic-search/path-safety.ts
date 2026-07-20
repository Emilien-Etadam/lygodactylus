import fs from 'node:fs';
import path from 'node:path';
import { isPathWithinRoot } from '../tools/path-containment';

const caseInsensitive = process.platform === 'win32';

/**
 * Resolve a path and ensure it stays inside the workspace root.
 * Returns the real absolute path when the target exists.
 */
export function resolveContainedWorkspacePath(
  workspaceRoot: string,
  targetPath: string
): string | null {
  if (!workspaceRoot || !targetPath || targetPath.includes('\0') || workspaceRoot.includes('\0')) {
    return null;
  }

  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedTarget = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(resolvedRoot, targetPath);

  let realRoot = resolvedRoot;
  try {
    if (fs.existsSync(resolvedRoot)) {
      realRoot = fs.realpathSync(resolvedRoot);
    }
  } catch {
    realRoot = resolvedRoot;
  }

  let realTarget = resolvedTarget;
  try {
    if (fs.existsSync(resolvedTarget)) {
      realTarget = fs.realpathSync(resolvedTarget);
    }
  } catch {
    realTarget = resolvedTarget;
  }

  if (!isPathWithinRoot(realTarget, realRoot, caseInsensitive)) {
    return null;
  }
  return realTarget;
}

/** Relative posix path from workspace root, or null if outside. */
export function toWorkspaceRelativePath(
  workspaceRoot: string,
  absolutePath: string
): string | null {
  const contained = resolveContainedWorkspacePath(workspaceRoot, absolutePath);
  if (!contained) {
    return null;
  }
  const root = resolveContainedWorkspacePath(workspaceRoot, workspaceRoot);
  if (!root) {
    return null;
  }
  const relative = path.relative(root, contained);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(path.sep).join('/');
}
