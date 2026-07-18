/**
 * @module main/browser-extension-installer
 *
 * Generic one-click extension install engine shared by the Firefox and
 * Thunderbird integrations. Downloads the latest `<prefix>*` GitHub release
 * `.xpi` into the user's Downloads folder, detects installed target browsers,
 * and opens the `.xpi` with one so the browser shows its native install prompt.
 * Fully silent install is not possible; the user always confirms.
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { delimiter, join, posix as pathPosix, win32 as pathWin32 } from 'node:path';
import { homedir } from 'node:os';
import { app } from 'electron';
import { log, logError } from './utils/logger';
import type { FirefoxExtensionInstallResult } from '../shared/firefox-extension';

const GITHUB_OWNER = 'Emilien-Etadam';
const GITHUB_REPO = 'lygodactylus';
export const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=30`;
export const RELEASES_PAGE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name?: string;
  draft?: boolean;
  assets?: GitHubReleaseAsset[];
}

/** Parse a `<prefix>X.Y.Z` tag into numeric parts, or null if malformed. */
export function parseVersionTag(prefix: string, tag: string | undefined): number[] | null {
  if (!tag || !tag.startsWith(prefix)) {
    return null;
  }
  const version = tag.slice(prefix.length);
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

/** Highest-versioned non-draft `<prefix>*` release carrying a `.xpi` asset. */
export function pickLatestXpi(
  prefix: string,
  releases: GitHubRelease[]
): { version: string; asset: GitHubReleaseAsset } | null {
  let best: { parts: number[]; version: string; asset: GitHubReleaseAsset } | null = null;
  for (const release of releases) {
    if (release.draft) {
      continue;
    }
    const parts = parseVersionTag(prefix, release.tag_name);
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

async function fetchLatestXpi(
  prefix: string
): Promise<{ version: string; asset: GitHubReleaseAsset } | null> {
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
  return pickLatestXpi(prefix, Array.isArray(releases) ? releases : []);
}

/**
 * Download into Downloads: sandboxed browser builds (snap/flatpak on Linux)
 * cannot read dot-directories, and the user can retry manually from there.
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

/** A target browser and how to locate it on each platform. */
export interface BrowserCatalogEntry {
  id: string;
  name: string;
  /** macOS `.app` bundle names, probed under /Applications and ~/Applications. */
  macApps: string[];
  /** Windows exe subpaths, probed under Program Files / LocalAppData bases. */
  winPaths: string[];
  /** Linux binary names, resolved against PATH and common install dirs. */
  linuxBins: string[];
}

export interface DetectedBrowser {
  id: string;
  name: string;
  /** 'mac-app' → open via `open -a`; 'exe' → spawn the path directly. */
  kind: 'mac-app' | 'exe';
  path: string;
}

/** Ordered list of absolute candidate paths for an entry on a given platform. */
export function browserCandidatePaths(
  entry: BrowserCatalogEntry,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string
): { kind: 'mac-app' | 'exe'; path: string }[] {
  if (platform === 'darwin') {
    return entry.macApps.flatMap((appName) => [
      { kind: 'mac-app' as const, path: `/Applications/${appName}` },
      { kind: 'mac-app' as const, path: pathPosix.join(home, 'Applications', appName) },
    ]);
  }

  if (platform === 'win32') {
    const bases = [
      env['ProgramFiles'] ?? 'C:\\Program Files',
      env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      env['LOCALAPPDATA'] ?? pathWin32.join(home, 'AppData', 'Local'),
    ];
    return entry.winPaths.flatMap((rel) =>
      bases.map((base) => ({ kind: 'exe' as const, path: pathWin32.join(base, rel) }))
    );
  }

  // Linux and other POSIX: resolve each binary name against PATH plus the
  // common absolute dirs that native, snap and flatpak installs use.
  const pathSeparator = platform === (process.platform as NodeJS.Platform) ? delimiter : ':';
  const pathDirs = (env['PATH'] ?? '').split(pathSeparator).filter(Boolean);
  const extraDirs = [
    '/usr/bin',
    '/usr/local/bin',
    '/snap/bin',
    '/var/lib/flatpak/exports/bin',
    pathPosix.join(home, '.local', 'share', 'flatpak', 'exports', 'bin'),
    pathPosix.join(home, '.local', 'bin'),
  ];
  const dirs = Array.from(new Set([...pathDirs, ...extraDirs]));
  return entry.linuxBins.flatMap((bin) =>
    dirs.map((dir) => ({ kind: 'exe' as const, path: pathPosix.join(dir, bin) }))
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect installed browsers from a catalog. `exists` is injectable for testing;
 * it defaults to a real filesystem access check.
 */
export async function detectBrowsers(
  catalog: BrowserCatalogEntry[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  exists: (path: string) => Promise<boolean> = pathExists
): Promise<DetectedBrowser[]> {
  const detected: DetectedBrowser[] = [];
  for (const entry of catalog) {
    for (const candidate of browserCandidatePaths(entry, platform, env, home)) {
      if (await exists(candidate.path)) {
        detected.push({ id: entry.id, name: entry.name, kind: candidate.kind, path: candidate.path });
        break;
      }
    }
  }
  return detected;
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

async function launchBrowser(browser: DetectedBrowser, xpiPath: string): Promise<void> {
  if (browser.kind === 'mac-app') {
    await spawnDetached('open', ['-a', browser.path, xpiPath]);
    return;
  }
  await spawnDetached(browser.path, [xpiPath]);
}

/**
 * Full flow for a given extension family: locate the latest signed `.xpi`,
 * download it, then open it with a detected browser (or ask the user to pick
 * when several are installed). `notFoundError` distinguishes the "no browser"
 * outcome per family so the UI can show the right hint.
 */
export async function installBrowserExtension(config: {
  tagPrefix: string;
  catalog: BrowserCatalogEntry[];
  label: string;
  browserId?: string;
}): Promise<FirefoxExtensionInstallResult> {
  let picked: { version: string; asset: GitHubReleaseAsset } | null;
  try {
    picked = await fetchLatestXpi(config.tagPrefix);
  } catch (error) {
    logError(`[${config.label}] Release lookup failed:`, error);
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
    logError(`[${config.label}] Download failed:`, error);
    return {
      ok: false,
      error: 'download-failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const browsers = await detectBrowsers(config.catalog);

  if (browsers.length === 0) {
    return { ok: false, error: 'firefox-not-found', detail: xpiPath };
  }

  let target: DetectedBrowser | undefined;
  if (config.browserId) {
    target = browsers.find((b) => b.id === config.browserId);
    if (!target) {
      return { ok: false, error: 'firefox-not-found', detail: xpiPath };
    }
  } else if (browsers.length === 1) {
    target = browsers[0];
  } else {
    return {
      ok: false,
      error: 'choose-browser',
      xpiPath,
      browsers: browsers.map((b) => ({ id: b.id, name: b.name })),
    };
  }

  try {
    await launchBrowser(target, xpiPath);
  } catch (error) {
    logError(`[${config.label}] Failed to launch browser:`, error);
    return { ok: false, error: 'firefox-not-found', detail: xpiPath };
  }

  log(`[${config.label}] Opened ${xpiPath} (v${picked.version}) with ${target.name}`);
  return { ok: true, version: picked.version, xpiPath, browser: target.id };
}
