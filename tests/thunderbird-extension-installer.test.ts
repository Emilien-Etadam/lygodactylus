import { describe, expect, it } from 'vitest';

import {
  THUNDERBIRD_CATALOG,
  detectThunderbirdClients,
  parseThunderbirdTag,
  pickLatestThunderbirdXpi,
} from '../src/main/thunderbird-extension-installer';
import type { GitHubRelease } from '../src/main/browser-extension-installer';

const xpi = (name: string) => ({ name, browser_download_url: `https://example.com/${name}` });

describe('parseThunderbirdTag', () => {
  it('parses tbext-v tags and rejects the Firefox ext-v prefix', () => {
    expect(parseThunderbirdTag('tbext-v1.2.0')).toEqual([1, 2, 0]);
    expect(parseThunderbirdTag('ext-v1.0.0')).toBeNull();
    expect(parseThunderbirdTag('v6.2.1')).toBeNull();
  });
});

describe('pickLatestThunderbirdXpi', () => {
  it('selects the highest tbext-v release with an .xpi asset', () => {
    const releases: GitHubRelease[] = [
      { tag_name: 'ext-v9.9.9', assets: [xpi('firefox.xpi')] },
      { tag_name: 'tbext-v1.0.0', assets: [xpi('mail-1.0.0.xpi')] },
      { tag_name: 'tbext-v1.2.0', assets: [xpi('mail-1.2.0.xpi')] },
    ];
    expect(pickLatestThunderbirdXpi(releases)?.version).toBe('1.2.0');
  });
});

describe('detectThunderbirdClients', () => {
  it('detects Thunderbird and Betterbird by app bundle on macOS', async () => {
    const present = new Set(['/Applications/Thunderbird.app', '/Applications/Betterbird.app']);
    const detected = await detectThunderbirdClients('darwin', {}, '/Users/me', async (p) =>
      present.has(p)
    );
    expect(detected.map((b) => b.id)).toEqual(['thunderbird', 'betterbird']);
  });

  it('resolves the Linux binary against PATH', async () => {
    const detected = await detectThunderbirdClients(
      'linux',
      { PATH: '/usr/bin' },
      '/home/me',
      async (p) => p === '/usr/bin/thunderbird'
    );
    expect(detected).toHaveLength(1);
    expect(detected[0].id).toBe('thunderbird');
  });

  it('exposes stable catalog ids', () => {
    expect(THUNDERBIRD_CATALOG.map((e) => e.id)).toEqual(['thunderbird', 'betterbird']);
  });
});
