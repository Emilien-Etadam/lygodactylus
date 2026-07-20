import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TEMP_PLUGIN_PREFIX } from '../paths/sandbox-paths';
import { log, logWarn } from '../utils/logger';

const execFileAsync = promisify(execFile);

const GITHUB_USER_AGENT = 'lygodactylus-marketplace';

/** Shared headers for GitHub API / codeload (optional GITHUB_TOKEN). */
export function buildGithubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': GITHUB_USER_AGENT,
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Resolve a branch/tag/sha ref to a full commit SHA via the GitHub Commits API.
 * Returns null on any failure so callers can fall back silently.
 */
export async function resolveGithubCommitSha(repo: string, ref: string): Promise<string | null> {
  const [owner, name] = repo.split('/');
  if (!owner || !name || !ref.trim()) {
    return null;
  }

  try {
    const url = `https://api.github.com/repos/${owner}/${name}/commits/${encodeURIComponent(ref)}`;
    const response = await fetch(url, { headers: buildGithubHeaders() });
    if (!response.ok) {
      logWarn(
        `[GithubDownloader] Could not resolve ${repo}@${ref} to a commit SHA (${response.status})`
      );
      return null;
    }
    const payload = (await response.json()) as { sha?: unknown };
    if (typeof payload.sha === 'string' && /^[0-9a-f]{40}$/i.test(payload.sha)) {
      return payload.sha.toLowerCase();
    }
    return null;
  } catch (error) {
    logWarn(`[GithubDownloader] Commit SHA resolution failed for ${repo}@${ref}:`, error);
    return null;
  }
}

export async function downloadGithubSubdir(
  repo: string,
  subdir: string,
  ref: string
): Promise<string> {
  const [owner, name] = repo.split('/');
  if (!owner || !name) {
    throw new Error(`Invalid GitHub repo: ${repo}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PLUGIN_PREFIX));
  const archivePath = path.join(tempRoot, 'archive.tar.gz');
  const extractDir = path.join(tempRoot, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });

  const archiveUrl = `https://codeload.github.com/${owner}/${name}/tar.gz/${encodeURIComponent(ref)}`;
  const response = await fetch(archiveUrl, { headers: buildGithubHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to download GitHub archive (${response.status})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(archivePath, buffer);

  await execFileAsync('tar', ['-xzf', archivePath, '-C', extractDir], {
    maxBuffer: 20 * 1024 * 1024,
  });

  const extractedRoots = fs.readdirSync(extractDir);
  if (extractedRoots.length === 0) {
    throw new Error('GitHub archive was empty');
  }

  const repoRoot = path.join(extractDir, extractedRoots[0]);
  const pluginPath = path.join(repoRoot, subdir);
  if (!fs.existsSync(pluginPath) || !fs.statSync(pluginPath).isDirectory()) {
    throw new Error(`Plugin subdirectory not found: ${subdir}`);
  }

  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), `${TEMP_PLUGIN_PREFIX}copy-`));
  await copyDirectory(pluginPath, targetDir);
  log('[GithubDownloader] Prepared plugin directory:', targetDir);
  return targetDir;
}

async function copyDirectory(source: string, target: string): Promise<void> {
  fs.mkdirSync(target, { recursive: true });
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}
