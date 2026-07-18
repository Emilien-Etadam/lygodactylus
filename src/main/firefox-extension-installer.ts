/**
 * @module main/firefox-extension-installer
 *
 * Firefox-family configuration of the generic browser-extension installer.
 * Installs the AMO-signed "Lygodactylus Web" `.xpi` (latest `ext-v*` release)
 * into Firefox or a compatible fork (Waterfox, LibreWolf, Floorp, Mullvad,
 * Zen…), which honour AMO signatures.
 */
import { homedir } from 'node:os';
import {
  browserCandidatePaths,
  detectBrowsers,
  installBrowserExtension,
  parseVersionTag,
  pickLatestXpi,
  RELEASES_PAGE_URL,
  type BrowserCatalogEntry,
  type DetectedBrowser,
  type GitHubRelease,
  type GitHubReleaseAsset,
} from './browser-extension-installer';
import type { FirefoxExtensionInstallResult } from '../shared/firefox-extension';

export { RELEASES_PAGE_URL, browserCandidatePaths };
export type {
  FirefoxExtensionInstallError,
  FirefoxExtensionInstallResult,
} from '../shared/firefox-extension';
export type { BrowserCatalogEntry, DetectedBrowser, GitHubRelease, GitHubReleaseAsset };

const EXTENSION_TAG_PREFIX = 'ext-v';

/** Parse an `ext-vX.Y.Z` tag into numeric parts, or null if malformed. */
export function parseExtensionTag(tag: string | undefined): number[] | null {
  return parseVersionTag(EXTENSION_TAG_PREFIX, tag);
}

export function pickLatestExtensionXpi(
  releases: GitHubRelease[]
): { version: string; asset: GitHubReleaseAsset } | null {
  return pickLatestXpi(EXTENSION_TAG_PREFIX, releases);
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

/** Detect installed Firefox-family browsers. */
export function detectFirefoxBrowsers(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  exists?: (path: string) => Promise<boolean>
): Promise<DetectedBrowser[]> {
  return detectBrowsers(BROWSER_CATALOG, platform, env, home, exists);
}

export function installFirefoxExtension(
  browserId?: string
): Promise<FirefoxExtensionInstallResult> {
  return installBrowserExtension({
    tagPrefix: EXTENSION_TAG_PREFIX,
    catalog: BROWSER_CATALOG,
    label: 'FirefoxExtension',
    browserId,
  });
}
