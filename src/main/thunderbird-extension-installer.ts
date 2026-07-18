/**
 * @module main/thunderbird-extension-installer
 *
 * Thunderbird-family configuration of the generic browser-extension installer.
 * Installs the "Lygodactylus Mail" `.xpi` (latest `tbext-v*` release) into
 * Thunderbird or Betterbird.
 *
 * Note: the packaged `.xpi` is currently unsigned (Thunderbird uses ATN, not
 * AMO). Opening it still triggers Thunderbird's install prompt, but a release
 * build with signature enforcement will reject it unless the user sets
 * `xpinstall.signatures.required` to false or installs an ATN-signed build.
 */
import {
  detectBrowsers,
  installBrowserExtension,
  parseVersionTag,
  pickLatestXpi,
  type BrowserCatalogEntry,
  type DetectedBrowser,
  type GitHubRelease,
  type GitHubReleaseAsset,
} from './browser-extension-installer';
import type { FirefoxExtensionInstallResult } from '../shared/firefox-extension';
import { homedir } from 'node:os';

const TB_EXTENSION_TAG_PREFIX = 'tbext-v';

/** Parse a `tbext-vX.Y.Z` tag into numeric parts, or null if malformed. */
export function parseThunderbirdTag(tag: string | undefined): number[] | null {
  return parseVersionTag(TB_EXTENSION_TAG_PREFIX, tag);
}

export function pickLatestThunderbirdXpi(
  releases: GitHubRelease[]
): { version: string; asset: GitHubReleaseAsset } | null {
  return pickLatestXpi(TB_EXTENSION_TAG_PREFIX, releases);
}

/** Thunderbird and Betterbird. Thunderbird first — the picker display order. */
export const THUNDERBIRD_CATALOG: BrowserCatalogEntry[] = [
  {
    id: 'thunderbird',
    name: 'Thunderbird',
    macApps: ['Thunderbird.app', 'Thunderbird Daily.app'],
    winPaths: ['Mozilla Thunderbird\\thunderbird.exe'],
    linuxBins: ['thunderbird'],
  },
  {
    id: 'betterbird',
    name: 'Betterbird',
    macApps: ['Betterbird.app'],
    winPaths: ['Betterbird\\betterbird.exe'],
    linuxBins: ['betterbird'],
  },
];

/** Detect installed Thunderbird-family clients. */
export function detectThunderbirdClients(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  exists?: (path: string) => Promise<boolean>
): Promise<DetectedBrowser[]> {
  return detectBrowsers(THUNDERBIRD_CATALOG, platform, env, home, exists);
}

export function installThunderbirdExtension(
  browserId?: string
): Promise<FirefoxExtensionInstallResult> {
  return installBrowserExtension({
    tagPrefix: TB_EXTENSION_TAG_PREFIX,
    catalog: THUNDERBIRD_CATALOG,
    label: 'ThunderbirdExtension',
    browserId,
  });
}
