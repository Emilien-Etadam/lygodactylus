import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CatalogEntry, MarketplaceInstalledRecord } from '../../shared/catalog-types';
import { hashDirectoryContents } from '../../main/catalog/skill-content-hash';

const downloadGithubSubdir = vi.fn();
const resolveGithubCommitSha = vi.fn();
const marketplaceGet = vi.fn();
const marketplaceSave = vi.fn();
const marketplaceList = vi.fn(() => [] as MarketplaceInstalledRecord[]);
const marketplaceRemove = vi.fn();

vi.mock('../../main/catalog/github-downloader', () => ({
  downloadGithubSubdir: (...args: unknown[]) => downloadGithubSubdir(...args),
  resolveGithubCommitSha: (...args: unknown[]) => resolveGithubCommitSha(...args),
}));

vi.mock('../../main/catalog/marketplace-installed-store', () => ({
  marketplaceInstalledStore: {
    get: (...args: unknown[]) => marketplaceGet(...args),
    save: (...args: unknown[]) => marketplaceSave(...args),
    list: () => marketplaceList(),
    remove: (...args: unknown[]) => marketplaceRemove(...args),
  },
}));

vi.mock('../../main/catalog/catalog-aggregator', () => ({
  catalogAggregator: {
    listAllEntries: vi.fn(async () => [] as CatalogEntry[]),
    getEntry: vi.fn(),
    getMeta: vi.fn(),
    getSourceStatuses: vi.fn(async () => []),
    fetchExternalManifest: vi.fn(),
    invalidateSourceCache: vi.fn(),
  },
}));

const githubSkillEntry: CatalogEntry = {
  id: 'pinned-demo-skill',
  type: 'skill',
  name: 'Pinned Demo',
  description: 'Demo skill for integrity pinning',
  verified: true,
  resolve: {
    via: 'github',
    repo: 'acme/skills',
    subdir: 'skills/demo',
    ref: 'main',
  },
};

function writeSkillDir(root: string, body = 'echo ok\n'): void {
  fs.writeFileSync(
    path.join(root, 'SKILL.md'),
    '---\nname: Pinned Demo\ndescription: demo\n---\n',
    'utf8'
  );
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'run.sh'), body, 'utf8');
}

describe('marketplace skill integrity pinning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    marketplaceList.mockReturnValue([]);
    marketplaceGet.mockReturnValue(undefined);
  });

  it('resolves ref→sha, persists pin fields, and downloads the resolved sha', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-install-'));
    writeSkillDir(tempDir);
    const expectedHash = hashDirectoryContents(tempDir);

    resolveGithubCommitSha.mockResolvedValue('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    downloadGithubSubdir.mockResolvedValue(tempDir);

    const { InstallResolver } = await import('../../main/catalog/install-resolver');
    const installSkill = vi.fn(async () => ({
      id: 'global-Pinned Demo',
      name: 'Pinned Demo',
    }));

    const resolver = new InstallResolver(
      {
        installSkill,
        listSkills: vi.fn(async () => []),
        setSkillEnabled: vi.fn(),
        uninstallSkill: vi.fn(),
        getGlobalSkillsPath: vi.fn(() => tempDir),
      } as unknown as import('../../main/skills/skills-manager').SkillsManager,
      {
        installFromDirectory: vi.fn(),
        listInstalled: vi.fn(() => []),
        setEnabled: vi.fn(),
        uninstall: vi.fn(),
      } as unknown as import('../../main/skills/plugin-runtime-service').PluginRuntimeService
    );

    const result = await resolver.install(githubSkillEntry);

    expect(resolveGithubCommitSha).toHaveBeenCalledWith('acme/skills', 'main');
    expect(downloadGithubSubdir).toHaveBeenCalledWith(
      'acme/skills',
      'skills/demo',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    expect(marketplaceSave).toHaveBeenCalledWith(
      expect.objectContaining({
        catalogId: 'pinned-demo-skill',
        pinnedSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        contentHash: expectedHash,
        pinnedAt: expect.any(Number),
      })
    );
    expect(result.pinnedSha).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('falls back silently when SHA resolution fails (no pin fields)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-fallback-'));
    writeSkillDir(tempDir);

    resolveGithubCommitSha.mockResolvedValue(null);
    downloadGithubSubdir.mockResolvedValue(tempDir);

    const { InstallResolver } = await import('../../main/catalog/install-resolver');
    const installSkill = vi.fn(async () => ({
      id: 'global-Pinned Demo',
      name: 'Pinned Demo',
    }));

    const resolver = new InstallResolver(
      {
        installSkill,
        listSkills: vi.fn(async () => []),
        setSkillEnabled: vi.fn(),
        uninstallSkill: vi.fn(),
        getGlobalSkillsPath: vi.fn(() => tempDir),
      } as unknown as import('../../main/skills/skills-manager').SkillsManager,
      {
        installFromDirectory: vi.fn(),
        listInstalled: vi.fn(() => []),
        setEnabled: vi.fn(),
        uninstall: vi.fn(),
      } as unknown as import('../../main/skills/plugin-runtime-service').PluginRuntimeService
    );

    await resolver.install(githubSkillEntry);

    expect(downloadGithubSubdir).toHaveBeenCalledWith('acme/skills', 'skills/demo', 'main');
    const saved = marketplaceSave.mock.calls[0]?.[0] as MarketplaceInstalledRecord;
    expect(saved.pinnedSha).toBeUndefined();
    expect(saved.contentHash).toBeUndefined();
    expect(saved.pinnedAt).toBeUndefined();
  });

  it('treats legacy store entries without pin as unverified', async () => {
    const legacy: MarketplaceInstalledRecord = {
      catalogId: 'pinned-demo-skill',
      type: 'skill',
      installedRef: 'global-Pinned Demo',
      installedAt: 1,
    };
    marketplaceGet.mockReturnValue(legacy);

    const { MarketplaceService } = await import('../../main/catalog/marketplace-service');
    const service = new MarketplaceService(
      {
        listSkills: vi.fn(async () => [
          { id: 'global-Pinned Demo', name: 'Pinned Demo', type: 'custom', enabled: true },
        ]),
        getGlobalSkillsPath: vi.fn(() => os.tmpdir()),
      } as unknown as import('../../main/skills/skills-manager').SkillsManager,
      {
        listInstalled: vi.fn(() => []),
      } as unknown as import('../../main/skills/plugin-runtime-service').PluginRuntimeService
    );

    const result = await service.verifyIntegrity('pinned-demo-skill');
    expect(result.status).toBe('unverified');
    expect(result.pinnedSha).toBeUndefined();
  });

  it('detects local modification against pinned contentHash', async () => {
    const skillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-skills-'));
    const skillDir = path.join(skillsRoot, 'Pinned Demo');
    fs.mkdirSync(skillDir, { recursive: true });
    writeSkillDir(skillDir, 'echo original\n');
    const contentHash = hashDirectoryContents(skillDir);

    const record: MarketplaceInstalledRecord = {
      catalogId: 'pinned-demo-skill',
      type: 'skill',
      installedRef: 'global-Pinned Demo',
      installedAt: 1,
      pinnedSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      contentHash,
      pinnedAt: 1,
    };
    marketplaceGet.mockReturnValue(record);

    const { MarketplaceService } = await import('../../main/catalog/marketplace-service');
    const service = new MarketplaceService(
      {
        listSkills: vi.fn(async () => [
          { id: 'global-Pinned Demo', name: 'Pinned Demo', type: 'custom', enabled: true },
        ]),
        getGlobalSkillsPath: vi.fn(() => skillsRoot),
      } as unknown as import('../../main/skills/skills-manager').SkillsManager,
      {
        listInstalled: vi.fn(() => []),
      } as unknown as import('../../main/skills/plugin-runtime-service').PluginRuntimeService
    );

    expect((await service.verifyIntegrity('pinned-demo-skill')).status).toBe('ok');

    fs.writeFileSync(path.join(skillDir, 'scripts', 'run.sh'), 'echo tampered\n', 'utf8');
    expect((await service.verifyIntegrity('pinned-demo-skill')).status).toBe('modified');
  });

  it('rollback reinstalls at the pinned SHA', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-rollback-'));
    writeSkillDir(tempDir);

    const pinnedSha = 'cccccccccccccccccccccccccccccccccccccccc';
    marketplaceGet.mockReturnValue({
      catalogId: 'pinned-demo-skill',
      type: 'skill',
      installedRef: 'global-Pinned Demo',
      installedAt: 1,
      pinnedSha,
      contentHash: 'deadbeef',
      pinnedAt: 1,
    } satisfies MarketplaceInstalledRecord);

    resolveGithubCommitSha.mockResolvedValue(pinnedSha);
    downloadGithubSubdir.mockResolvedValue(tempDir);

    const { catalogAggregator } = await import('../../main/catalog/catalog-aggregator');
    vi.mocked(catalogAggregator.getEntry).mockResolvedValue(githubSkillEntry);

    const { MarketplaceService } = await import('../../main/catalog/marketplace-service');
    const installSkill = vi.fn(async () => ({
      id: 'global-Pinned Demo',
      name: 'Pinned Demo',
    }));

    const service = new MarketplaceService(
      {
        installSkill,
        listSkills: vi.fn(async () => []),
        setSkillEnabled: vi.fn(),
        uninstallSkill: vi.fn(),
        getGlobalSkillsPath: vi.fn(() => tempDir),
      } as unknown as import('../../main/skills/skills-manager').SkillsManager,
      {
        installFromDirectory: vi.fn(),
        listInstalled: vi.fn(() => []),
        setEnabled: vi.fn(),
        uninstall: vi.fn(),
      } as unknown as import('../../main/skills/plugin-runtime-service').PluginRuntimeService
    );

    await service.rollback('pinned-demo-skill');

    expect(downloadGithubSubdir).toHaveBeenCalledWith('acme/skills', 'skills/demo', pinnedSha);
  });
});
