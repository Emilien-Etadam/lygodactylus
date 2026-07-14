import { describe, expect, it, vi } from 'vitest';
import type { CatalogManifest, CatalogSource } from '../src/shared/catalog-types';

vi.mock('electron', () => {
  const app = {
    getAppPath: () => process.cwd(),
    getPath: () => '/tmp/lygodactylus-test',
    getVersion: () => '0.0.0-test',
    getName: () => 'lygodactylus-test',
    name: 'lygodactylus-test',
    isPackaged: false,
  };
  const ipcMain = { handle: () => {}, on: () => {} };
  const shell = { openPath: async () => '' };
  // electron-store reads `app` off the default export.
  return { app, ipcMain, shell, default: { app, ipcMain, shell } };
});

import { validateCatalogManifest } from '../src/shared/catalog-manifest-validator';
import { CatalogAggregator } from '../src/main/catalog/catalog-aggregator';
import { catalogSourceIdForUrl } from '../src/main/catalog/catalog-sources-store';

const EXTERNAL_URL = 'https://example.com/catalog/manifest.json';

const externalManifest: CatalogManifest = {
  version: '1',
  updatedAt: '2026-07-01',
  policy: 'community',
  entries: [
    {
      id: 'cool-skill',
      type: 'skill',
      name: 'Cool Skill',
      description: 'A community skill',
      verified: true,
      resolve: { via: 'github', repo: 'acme/skills', subdir: 'skills/cool', ref: 'main' },
    },
    {
      id: 'old-skill',
      type: 'skill',
      name: 'Old Skill',
      description: 'Deprecated skill',
      verified: false,
      deprecated: true,
      resolve: { via: 'github', repo: 'acme/skills', subdir: 'skills/old', ref: 'main' },
    },
  ],
};

const source: CatalogSource = {
  id: catalogSourceIdForUrl(EXTERNAL_URL),
  name: 'Acme',
  url: EXTERNAL_URL,
  addedAt: 1,
};

function fetchStub(externalBody: unknown, externalStatus = 200): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === EXTERNAL_URL) {
      return new Response(JSON.stringify(externalBody), { status: externalStatus });
    }
    // Official remote manifest unavailable -> bundled fallback.
    return new Response('{}', { status: 500 });
  }) as typeof fetch;
}

describe('external catalog manifest validation', () => {
  it('accepts unverified entries in the external profile', () => {
    const result = validateCatalogManifest(
      { ...externalManifest, entries: [{ ...externalManifest.entries[0], verified: false }] },
      'external'
    );
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects builtin and preset resolve strategies in external catalogs', () => {
    for (const resolve of [
      { via: 'builtin', path: 'docx' },
      { via: 'preset', presetKey: 'chrome' },
    ]) {
      const result = validateCatalogManifest(
        { ...externalManifest, entries: [{ ...externalManifest.entries[0], resolve }] },
        'external'
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('not allowed'))).toBe(true);
    }
  });

  it('still enforces curated-strict for the official profile', () => {
    const result = validateCatalogManifest(externalManifest);
    expect(result.valid).toBe(false);
  });
});

describe('CatalogAggregator with external sources', () => {
  it('merges namespaced external entries after official ones', async () => {
    const aggregator = new CatalogAggregator(fetchStub(externalManifest), () => [source]);
    const entries = await aggregator.listAllEntries(true);

    const external = entries.filter((entry) => entry.sourceId);
    expect(external).toHaveLength(1);
    expect(external[0].id).toBe(`${source.id}/cool-skill`);
    expect(external[0].verified).toBe(false);
    expect(external[0].sourceName).toBe('Acme');

    // Official entries stay first and untouched.
    expect(entries[0].sourceId).toBeUndefined();
    expect(entries[0].verified).toBe(true);
  });

  it('resolves a namespaced external entry via getEntry', async () => {
    const aggregator = new CatalogAggregator(fetchStub(externalManifest), () => [source]);
    const entry = await aggregator.getEntry(`${source.id}/cool-skill`, true);
    expect(entry?.name).toBe('Cool Skill');
    expect(entry?.sourceId).toBe(source.id);

    expect(await aggregator.getEntry(`${source.id}/missing`, true)).toBeUndefined();
    expect(await aggregator.getEntry('unknown-source/cool-skill', true)).toBeUndefined();
  });

  it('reports an error status and no entries for an unreachable source', async () => {
    const aggregator = new CatalogAggregator(fetchStub({}, 500), () => [source]);
    const entries = await aggregator.listAllEntries(true);
    expect(entries.every((entry) => !entry.sourceId)).toBe(true);

    const statuses = await aggregator.getSourceStatuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].state).toBe('error');
    expect(statuses[0].entryCount).toBe(0);
  });

  it('rejects an external manifest that fails validation', async () => {
    const invalid = {
      ...externalManifest,
      entries: [
        {
          ...externalManifest.entries[0],
          resolve: { via: 'builtin', path: 'docx' },
        },
      ],
    };
    const aggregator = new CatalogAggregator(fetchStub(invalid), () => [source]);
    await expect(aggregator.fetchExternalManifest(EXTERNAL_URL)).rejects.toThrow(/validation/);

    const entries = await aggregator.listAllEntries(true);
    expect(entries.every((entry) => !entry.sourceId)).toBe(true);
  });

  it('reports ok statuses with entry counts', async () => {
    const aggregator = new CatalogAggregator(fetchStub(externalManifest), () => [source]);
    const statuses = await aggregator.getSourceStatuses(true);
    expect(statuses).toHaveLength(1);
    expect(statuses[0].state).toBe('ok');
    // Deprecated entries are excluded from the count.
    expect(statuses[0].entryCount).toBe(1);
  });
});
