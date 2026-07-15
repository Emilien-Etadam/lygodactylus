import { describe, expect, it } from 'vitest';

import {
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
