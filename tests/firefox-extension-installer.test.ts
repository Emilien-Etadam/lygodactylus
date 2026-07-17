import { describe, expect, it } from 'vitest';

import {
  BROWSER_CATALOG,
  browserCandidatePaths,
  detectFirefoxBrowsers,
  parseExtensionTag,
  pickLatestExtensionXpi,
  type GitHubRelease,
} from '../src/main/firefox-extension-installer';

const xpi = (name: string) => ({
  name,
  browser_download_url: `https://example.com/${name}`,
});

describe('parseExtensionTag', () => {
  it('parses ext-v tags into numeric parts', () => {
    expect(parseExtensionTag('ext-v1.2.3')).toEqual([1, 2, 3]);
    expect(parseExtensionTag('ext-v10.0')).toEqual([10, 0]);
  });

  it('rejects app release tags and malformed versions', () => {
    expect(parseExtensionTag('v6.0.2')).toBeNull();
    expect(parseExtensionTag('ext-v1.2.3-beta')).toBeNull();
    expect(parseExtensionTag('ext-v')).toBeNull();
    expect(parseExtensionTag(undefined)).toBeNull();
  });
});

describe('pickLatestExtensionXpi', () => {
  it('picks the highest ext-v version carrying an .xpi asset', () => {
    const releases: GitHubRelease[] = [
      { tag_name: 'v6.0.2', assets: [xpi('app.exe')] },
      { tag_name: 'ext-v1.0.0', assets: [xpi('lygodactylus_web-1.0.0.xpi')] },
      { tag_name: 'ext-v1.2.0', assets: [xpi('lygodactylus_web-1.2.0.xpi')] },
      { tag_name: 'ext-v1.1.0', assets: [xpi('lygodactylus_web-1.1.0.xpi')] },
    ];
    const picked = pickLatestExtensionXpi(releases);
    expect(picked?.version).toBe('1.2.0');
    expect(picked?.asset.name).toBe('lygodactylus_web-1.2.0.xpi');
  });

  it('skips drafts and releases without an .xpi asset', () => {
    const releases: GitHubRelease[] = [
      { tag_name: 'ext-v2.0.0', draft: true, assets: [xpi('lygodactylus_web-2.0.0.xpi')] },
      { tag_name: 'ext-v1.9.0', assets: [{ name: 'notes.txt', browser_download_url: 'u' }] },
      { tag_name: 'ext-v1.5.0', assets: [xpi('lygodactylus_web-1.5.0.xpi')] },
    ];
    expect(pickLatestExtensionXpi(releases)?.version).toBe('1.5.0');
  });

  it('returns null when no extension release exists', () => {
    expect(pickLatestExtensionXpi([])).toBeNull();
    expect(pickLatestExtensionXpi([{ tag_name: 'v6.0.2', assets: [] }])).toBeNull();
  });

  it('compares versions numerically, not lexicographically', () => {
    const releases: GitHubRelease[] = [
      { tag_name: 'ext-v1.10.0', assets: [xpi('a.xpi')] },
      { tag_name: 'ext-v1.9.0', assets: [xpi('b.xpi')] },
    ];
    expect(pickLatestExtensionXpi(releases)?.version).toBe('1.10.0');
  });
});

describe('browserCandidatePaths', () => {
  const firefox = BROWSER_CATALOG.find((b) => b.id === 'firefox')!;
  const waterfox = BROWSER_CATALOG.find((b) => b.id === 'waterfox')!;

  it('probes macOS app bundles under /Applications and ~/Applications', () => {
    const paths = browserCandidatePaths(waterfox, 'darwin', {}, '/Users/me');
    expect(paths).toEqual([
      { kind: 'mac-app', path: '/Applications/Waterfox.app' },
      { kind: 'mac-app', path: '/Users/me/Applications/Waterfox.app' },
    ]);
  });

  it('probes Windows exe bases (Program Files + LocalAppData)', () => {
    const paths = browserCandidatePaths(
      firefox,
      'win32',
      { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\LA' },
      'C:\\Users\\me'
    );
    expect(paths.map((p) => p.path)).toEqual([
      'C:\\PF\\Mozilla Firefox\\firefox.exe',
      'C:\\PF86\\Mozilla Firefox\\firefox.exe',
      'C:\\LA\\Mozilla Firefox\\firefox.exe',
    ]);
    expect(paths.every((p) => p.kind === 'exe')).toBe(true);
  });

  it('resolves Linux binaries against PATH and common install dirs', () => {
    const paths = browserCandidatePaths(waterfox, 'linux', { PATH: '/opt/bin' }, '/home/me');
    const resolved = paths.map((p) => p.path);
    expect(resolved).toContain('/opt/bin/waterfox');
    expect(resolved).toContain('/usr/bin/waterfox');
    expect(resolved).toContain('/snap/bin/waterfox');
    expect(resolved).toContain('/var/lib/flatpak/exports/bin/waterfox');
  });
});

describe('detectFirefoxBrowsers', () => {
  it('detects only the browsers whose path exists, in catalog order', async () => {
    const present = new Set([
      '/Applications/Firefox.app',
      '/Applications/Waterfox.app',
      '/Applications/LibreWolf.app',
    ]);
    const detected = await detectFirefoxBrowsers(
      'darwin',
      {},
      '/Users/me',
      async (p) => present.has(p)
    );
    expect(detected.map((b) => b.id)).toEqual(['firefox', 'waterfox', 'librewolf']);
    expect(detected.every((b) => b.kind === 'mac-app')).toBe(true);
  });

  it('returns an empty list when no browser is installed', async () => {
    const detected = await detectFirefoxBrowsers('linux', { PATH: '/usr/bin' }, '/home/me', async () => false);
    expect(detected).toEqual([]);
  });

  it('picks the first existing candidate per browser (no duplicates)', async () => {
    const detected = await detectFirefoxBrowsers(
      'win32',
      { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86' },
      'C:\\Users\\me',
      async (p) => p === 'C:\\PF\\Waterfox\\waterfox.exe' || p === 'C:\\PF86\\Waterfox\\waterfox.exe'
    );
    expect(detected).toHaveLength(1);
    expect(detected[0]).toMatchObject({ id: 'waterfox', path: 'C:\\PF\\Waterfox\\waterfox.exe' });
  });
});
