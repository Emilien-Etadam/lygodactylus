/**
 * @module main/firefox-extension-installer
 *
 * One-click install of the "Lygodactylus Web" Firefox extension: downloads the
 * AMO-signed .xpi from the latest `ext-v*` GitHub release into the user's
 * Downloads folder, then opens it with Firefox so the browser shows its native
 * install prompt. Fully silent install is not possible on Firefox release —
 * the user always confirms with one click.
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { app } from 'electron';
import { log, logError } from './utils/logger';

const GITHUB_OWNER = 'Emilien-Etadam';
const GITHUB_REPO = 'lygodactylus';
const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=30`;
export const RELEASES_PAGE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const EXTENSION_TAG_PREFIX = 'ext-v';

export type FirefoxExtensionInstallError = 'no-release' | 'download-failed' | 'firefox-not-found';

export type FirefoxExtensionInstallResult =
  | { ok: true; version: string; xpiPath: string }
  | { ok: false; error: FirefoxExtensionInstallError; detail?: string };

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name?: string;
  draft?: boolean;
  assets?: GitHubReleaseAsset[];
}

/** Parse an `ext-vX.Y.Z` tag into numeric parts, or null if malformed. */
export function parseExtensionTag(tag: string | undefined): number[] | null {
  if (!tag || !tag.startsWith(EXTENSION_TAG_PREFIX)) {
    return null;
  }
  const version = tag.slice(EXTENSION_TAG_PREFIX.length);
  if (!/^\d+(\.\d+)*$/.test(version)) {
    return null;
  }
  return version.split('.').map(Number);
}

function compareVersions(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * Pick the highest-versioned non-draft `ext-v*` release that carries a signed
 * .xpi asset.
 */
export function pickLatestExtensionXpi(
  releases: GitHubRelease[]
): { version: string; asset: GitHubReleaseAsset } | null {
  let best: { parts: number[]; version: string; asset: GitHubReleaseAsset } | null = null;
  for (const release of releases) {
    if (release.draft) {
      continue;
    }
    const parts = parseExtensionTag(release.tag_name);
    if (!parts) {
      continue;
    }
    const asset = release.assets?.find((a) => a.name.toLowerCase().endsWith('.xpi'));
    if (!asset) {
      continue;
    }
    if (!best || compareVersions(parts, best.parts) > 0) {
      best = { parts, version: parts.join('.'), asset };
    }
  }
  return best ? { version: best.version, asset: best.asset } : null;
}

async function fetchLatestExtensionXpi(): Promise<{
  version: string;
  asset: GitHubReleaseAsset;
} | null> {
  const response = await fetch(RELEASES_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `${GITHUB_REPO}-extension-install`,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}`);
  }
  const releases = (await response.json()) as GitHubRelease[];
  return pickLatestExtensionXpi(Array.isArray(releases) ? releases : []);
}

/**
 * Download into the user's Downloads folder: sandboxed Firefox builds
 * (snap/flatpak on Linux) cannot read dot-directories like userData, and the
 * user can retry manually from there if Firefox is missing.
 */
async function downloadXpi(asset: GitHubReleaseAsset): Promise<string> {
  const response = await fetch(asset.browser_download_url, {
    headers: { 'User-Agent': `${GITHUB_REPO}-extension-install` },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (HTTP ${response.status})`);
  }
  const targetPath = join(app.getPath('downloads'), asset.name);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(targetPath));
  return targetPath;
}

async function firstExistingPath(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/** Open the .xpi with Firefox; resolves false when no Firefox binary is found. */
export async function openXpiWithFirefox(xpiPath: string): Promise<boolean> {
  if (process.platform === 'darwin') {
    const appPath = await firstExistingPath([
      '/Applications/Firefox.app',
      join(homedir(), 'Applications', 'Firefox.app'),
    ]);
    if (!appPath) {
      return false;
    }
    await spawnDetached('open', ['-a', appPath, xpiPath]);
    return true;
  }

  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
    const exePath = await firstExistingPath([
      join(programFiles, 'Mozilla Firefox', 'firefox.exe'),
      join(programFilesX86, 'Mozilla Firefox', 'firefox.exe'),
      join(localAppData, 'Mozilla Firefox', 'firefox.exe'),
    ]);
    if (!exePath) {
      return false;
    }
    await spawnDetached(exePath, [xpiPath]);
    return true;
  }

  // Linux: rely on PATH (covers native, snap and flatpak wrapper scripts).
  for (const binary of ['firefox', 'firefox-esr']) {
    try {
      await spawnDetached(binary, [xpiPath]);
      return true;
    } catch {
      // try the next candidate
    }
  }
  return false;
}

/**
 * Full flow: locate the latest signed .xpi, download it, open it with Firefox.
 * On `firefox-not-found` the .xpi is already on disk — `detail` carries its path
 * so the UI can point the user at a manual install via about:addons.
 */
export async function installFirefoxExtension(): Promise<FirefoxExtensionInstallResult> {
  let picked: { version: string; asset: GitHubReleaseAsset } | null;
  try {
    picked = await fetchLatestExtensionXpi();
  } catch (error) {
    logError('[FirefoxExtension] Release lookup failed:', error);
    return {
      ok: false,
      error: 'download-failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (!picked) {
    return { ok: false, error: 'no-release' };
  }

  let xpiPath: string;
  try {
    xpiPath = await downloadXpi(picked.asset);
  } catch (error) {
    logError('[FirefoxExtension] Download failed:', error);
    return {
      ok: false,
      error: 'download-failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    if (!(await openXpiWithFirefox(xpiPath))) {
      return { ok: false, error: 'firefox-not-found', detail: xpiPath };
    }
  } catch (error) {
    logError('[FirefoxExtension] Failed to launch Firefox:', error);
    return { ok: false, error: 'firefox-not-found', detail: xpiPath };
  }

  log(`[FirefoxExtension] Opened ${xpiPath} (v${picked.version}) with Firefox`);
  return { ok: true, version: picked.version, xpiPath };
}
