import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CatalogEntry } from '../src/shared/catalog-types';

const manifestEntries: CatalogEntry[] = [
  {
    id: 'demo-skill',
    type: 'skill',
    name: 'Demo Skill',
    description: 'Demo',
    verified: true,
    resolve: { via: 'builtin', path: 'docx' },
  },
];

vi.mock('../src/main/catalog/catalog-aggregator', () => ({
  catalogAggregator: {
    listVerifiedEntries: vi.fn(async () => manifestEntries),
    listAllEntries: vi.fn(async () => manifestEntries),
    getEntry: vi.fn(async (id: string) => manifestEntries.find((entry) => entry.id === id)),
    getSourceStatuses: vi.fn(async () => []),
    fetchExternalManifest: vi.fn(async () => ({
      version: '1',
      updatedAt: '2026-07-01',
      policy: 'community',
      entries: [
        {
          id: 'remote-skill',
          type: 'skill',
          name: 'Remote Skill',
          description: 'Remote',
          verified: false,
          resolve: { via: 'github', repo: 'acme/skills', subdir: 'skills/remote', ref: 'main' },
        },
      ],
    })),
    invalidateSourceCache: vi.fn(),
  },
}));

function buildService(
  MarketplaceService: typeof import('../src/main/catalog/marketplace-service').MarketplaceService
) {
  const skillsManager = {
    listSkills: vi.fn(async () => [
      { id: 'builtin-docx', name: 'DOCX', type: 'builtin', enabled: true },
    ]),
    setSkillEnabled: vi.fn(),
    installSkill: vi.fn(),
    uninstallSkill: vi.fn(),
  } as unknown as import('../src/main/skills/skills-manager').SkillsManager;

  const pluginRuntimeService = {
    listInstalled: vi.fn(() => []),
    installFromDirectory: vi.fn(),
    setEnabled: vi.fn(),
    uninstall: vi.fn(),
  } as unknown as import('../src/main/skills/plugin-runtime-service').PluginRuntimeService;

  return new MarketplaceService(skillsManager, pluginRuntimeService);
}

describe('MarketplaceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists marketplace entries with builtin install state', async () => {
    const { MarketplaceService } = await import('../src/main/catalog/marketplace-service');
    const service = buildService(MarketplaceService);
    const entries = await service.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].installState).toBe('builtin');
    expect(entries[0].enabled).toBe(true);
  });

  it('rejects catalog sources that are not https', async () => {
    const { MarketplaceService } = await import('../src/main/catalog/marketplace-service');
    const service = buildService(MarketplaceService);
    await expect(service.addSource('http://example.com/manifest.json')).rejects.toThrow(/https/);
    await expect(service.addSource('not a url')).rejects.toThrow(/Invalid catalog URL/);
  });

  it('adds, deduplicates, and removes a catalog source', async () => {
    const { MarketplaceService } = await import('../src/main/catalog/marketplace-service');
    const { catalogSourceIdForUrl } = await import('../src/main/catalog/catalog-sources-store');
    const service = buildService(MarketplaceService);

    const url = 'https://example.com/test-catalog/manifest.json';
    // Clean up leftovers from previous runs (the store persists on disk).
    await service.removeSource(catalogSourceIdForUrl(url));

    const status = await service.addSource(url, 'Test Catalog');
    expect(status.state).toBe('ok');
    expect(status.name).toBe('Test Catalog');
    expect(status.entryCount).toBe(1);
    expect(status.id).toBe(catalogSourceIdForUrl(url));

    await expect(service.addSource(url)).rejects.toThrow(/already added/);

    expect((await service.removeSource(status.id)).success).toBe(true);
    expect((await service.removeSource(status.id)).success).toBe(false);
  });
});
