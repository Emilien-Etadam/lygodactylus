/**
 * @module main/firefox-extension-installer
 *
 * One-click install of the "Lygodactylus Web" browser extension: downloads the
 * AMO-signed .xpi from the latest `ext-v*` GitHub release into the user's
 * Downloads folder, then opens it with a Firefox-family browser so the browser
 * shows its native install prompt. The signed .xpi installs not only in Firefox
 * but in its forks (Waterfox, LibreWolf, Floorp, Mullvad Browser, Zen…), which
 * honour AMO signatures — so we detect those too. Fully silent install is not
 * possible; the user always confirms with one click.
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

export type {
  FirefoxExtensionInstallError,
  FirefoxExtensionInstallResult,
} from '../shared/firefox-extension';

const GITHUB_OWNER = 'Emilien-Etadam';
const GITHUB_REPO = 'lygodactylus';
const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=30`;
export const RELEASES_PAGE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const EXTENSION_TAG_PREFIX = 'ext-v';

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
 * Download into the user's Downloads folder: sandboxed browser builds
 * (snap/flatpak on Linux) cannot read dot-directories like userData, and the
 * user can retry manually from there if no browser is detected.
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

/** A Firefox-family browser and how to locate it on each platform. */
interface BrowserCatalogEntry {
  id: string;
  name: string;
  /** macOS `.app` bundle names, probed under /Applications and ~/Applications. */
  macApps: string[];
  /** Windows exe subpaths, probed under Program Files / LocalAppData bases. */
  winPaths: string[];
  /** Linux binary names, resolved against PATH and common install dirs. */
  linuxBins: string[];
}

/**
 * Firefox and the forks that accept AMO-signed extensions. Firefox first, then
 * forks — the order is the display order in the picker.
 */
export const BROWSER_CATALOG: BrowserCatalogEntry[] = [
  {
    id: 'firefox',
    name: 'Firefox',
    macApps: ['Firefox.app'],
    winPaths: ['Mozilla Firefox\\firefox.exe'],
    linuxBins: ['firefox', 'firefox-esr'],
  },
  {
    id: 'firefox-developer',
    name: 'Firefox Developer Edition',
    macApps: ['Firefox Developer Edition.app'],
    winPaths: ['Firefox Developer Edition\\firefox.exe'],
    linuxBins: ['firefox-developer-edition', 'firefox-dev'],
  },
  {
    id: 'firefox-nightly',
    name: 'Firefox Nightly',
    macApps: ['Firefox Nightly.app'],
    winPaths: ['Firefox Nightly\\firefox.exe'],
    linuxBins: ['firefox-nightly'],
  },
  {
    id: 'waterfox',
    name: 'Waterfox',
    macApps: ['Waterfox.app'],
    winPaths: ['Waterfox\\waterfox.exe'],
    linuxBins: ['waterfox'],
  },
  {
    id: 'librewolf',
    name: 'LibreWolf',
    macApps: ['LibreWolf.app'],
    winPaths: ['LibreWolf\\librewolf.exe'],
    linuxBins: ['librewolf'],
  },
  {
    id: 'floorp',
    name: 'Floorp',
    macApps: ['Floorp.app'],
    winPaths: ['Floorp\\floorp.exe'],
    linuxBins: ['floorp'],
  },
  {
    id: 'mullvad-browser',
    name: 'Mullvad Browser',
    macApps: ['Mullvad Browser.app'],
    winPaths: ['Mullvad Browser\\mullvadbrowser.exe'],
    linuxBins: ['mullvad-browser'],
  },
  {
    id: 'zen',
    name: 'Zen Browser',
    macApps: ['Zen Browser.app', 'Zen.app'],
    winPaths: ['Zen Browser\\zen.exe', 'Zen\\zen.exe'],
    linuxBins: ['zen', 'zen-browser'],
  },
];

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
  // common absolute dirs that native, snap and flatpak installs use. Split on
  // the POSIX delimiter regardless of host so detection is deterministic.
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

/**
 * Detect installed Firefox-family browsers. `exists` is injectable for testing;
 * it defaults to a real filesystem access check.
 */
export async function detectFirefoxBrowsers(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  exists: (path: string) => Promise<boolean> = pathExists
): Promise<DetectedBrowser[]> {
  const detected: DetectedBrowser[] = [];
  for (const entry of BROWSER_CATALOG) {
    for (const candidate of browserCandidatePaths(entry, platform, env, home)) {
      if (await exists(candidate.path)) {
        detected.push({ id: entry.id, name: entry.name, kind: candidate.kind, path: candidate.path });
        break;
      }
    }
  }
  return detected;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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

/** Open the .xpi with a detected browser. */
async function launchBrowser(browser: DetectedBrowser, xpiPath: string): Promise<void> {
  if (browser.kind === 'mac-app') {
    await spawnDetached('open', ['-a', browser.path, xpiPath]);
    return;
  }
  await spawnDetached(browser.path, [xpiPath]);
}

/**
 * Full flow: locate the latest signed .xpi, download it, then open it with a
 * Firefox-family browser.
 *
 * - `browserId` set → open that specific detected browser (the UI's second call
 *   after the user picks one).
 * - no browser installed → `firefox-not-found` (`detail` carries the .xpi path
 *   so the UI can point at a manual install via about:addons).
 * - exactly one browser → open it.
 * - several browsers → `choose-browser` with the candidate list (nothing opened
 *   yet); the UI prompts and calls again with a `browserId`.
 */
export async function installFirefoxExtension(
  browserId?: string
): Promise<FirefoxExtensionInstallResult> {
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

  const browsers = await detectFirefoxBrowsers();

  if (browsers.length === 0) {
    return { ok: false, error: 'firefox-not-found', detail: xpiPath };
  }

  let target: DetectedBrowser | undefined;
  if (browserId) {
    target = browsers.find((b) => b.id === browserId);
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
    logError('[FirefoxExtension] Failed to launch browser:', error);
    return { ok: false, error: 'firefox-not-found', detail: xpiPath };
  }

  log(`[FirefoxExtension] Opened ${xpiPath} (v${picked.version}) with ${target.name}`);
  return { ok: true, version: picked.version, xpiPath, browser: target.id };
}
