import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  CatalogEntry,
  CatalogEntryType,
  CatalogManifestMeta,
  CatalogSourceStatus,
  MarketplaceEntry,
  MarketplaceInstallResult,
  MarketplaceIntegrityResult,
  SkillIntegrityStatus,
} from '../../shared/catalog-types';
import type { SkillsManager } from '../skills/skills-manager';
import type { PluginRuntimeService } from '../skills/plugin-runtime-service';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import { logWarn } from '../utils/logger';
import { catalogAggregator } from './catalog-aggregator';
import { catalogSourceIdForUrl, catalogSourcesStore } from './catalog-sources-store';
import { InstallResolver } from './install-resolver';
import { marketplaceInstalledStore } from './marketplace-installed-store';
import { hashDirectoryContents } from './skill-content-hash';

export interface MarketplaceUninstallResult {
  success: boolean;
  type?: CatalogEntryType;
  installedRef?: string;
}

export class MarketplaceService {
  private readonly installResolver: InstallResolver;
  /** In-memory integrity results from startup / explicit verify (never blocks install). */
  private readonly integrityCache = new Map<string, SkillIntegrityStatus>();

  constructor(
    private readonly skillsManager: SkillsManager,
    private readonly pluginRuntimeService: PluginRuntimeService
  ) {
    this.installResolver = new InstallResolver(skillsManager, pluginRuntimeService);
  }

  async list(forceRefresh = false): Promise<MarketplaceEntry[]> {
    const entries = await catalogAggregator.listAllEntries(forceRefresh);
    const skills = await this.skillsManager.listSkills();
    const mcpServers = mcpConfigStore.getServers();
    const plugins = this.pluginRuntimeService.listInstalled();

    return entries.map((entry) => this.toMarketplaceEntry(entry, skills, mcpServers, plugins));
  }

  async install(
    catalogId: string,
    envValues?: Record<string, string>
  ): Promise<MarketplaceInstallResult> {
    const entry = await catalogAggregator.getEntry(catalogId);
    if (!entry) {
      throw new Error(`Catalog entry not found: ${catalogId}`);
    }
    // Official entries must be verified; external entries are trusted because the
    // user explicitly added their catalog source.
    if (!entry.sourceId && !entry.verified) {
      throw new Error(`Catalog entry not found or not verified: ${catalogId}`);
    }
    const result = await this.installResolver.install(entry, envValues);
    if (result.pinnedSha) {
      this.integrityCache.set(catalogId, 'ok');
    }
    return result;
  }

  /**
   * Reinstall from the catalog ref and re-pin to the newly resolved commit SHA.
   * Skills without a github resolve simply re-run install (no pin side-effects).
   */
  async update(catalogId: string): Promise<MarketplaceInstallResult> {
    return this.install(catalogId);
  }

  /**
   * Reinstall the skill at its previously pinned commit SHA (integrity restore).
   */
  async rollback(catalogId: string): Promise<MarketplaceInstallResult> {
    const entry = await catalogAggregator.getEntry(catalogId);
    if (!entry) {
      throw new Error(`Catalog entry not found: ${catalogId}`);
    }
    if (entry.type !== 'skill' || entry.resolve.via !== 'github') {
      throw new Error('Rollback is only supported for GitHub marketplace skills');
    }
    const record = marketplaceInstalledStore.get(catalogId);
    if (!record?.pinnedSha) {
      throw new Error('No pinned commit SHA available for rollback');
    }
    const result = await this.installResolver.installGithubSkillAtRef(entry, record.pinnedSha);
    if (result.pinnedSha) {
      this.integrityCache.set(catalogId, 'ok');
    }
    return result;
  }

  async verifyIntegrity(catalogId: string): Promise<MarketplaceIntegrityResult> {
    const record = marketplaceInstalledStore.get(catalogId);
    if (!record || record.type !== 'skill') {
      const result: MarketplaceIntegrityResult = { catalogId, status: 'unverified' };
      this.integrityCache.set(catalogId, 'unverified');
      return result;
    }

    if (!record.contentHash || !record.pinnedSha) {
      const result: MarketplaceIntegrityResult = {
        catalogId,
        status: 'unverified',
        pinnedSha: record.pinnedSha,
        contentHash: record.contentHash,
      };
      this.integrityCache.set(catalogId, 'unverified');
      return result;
    }

    const skillPath = await this.resolveInstalledSkillPath(record.installedRef);
    if (!skillPath) {
      const result: MarketplaceIntegrityResult = {
        catalogId,
        status: 'modified',
        pinnedSha: record.pinnedSha,
        contentHash: record.contentHash,
      };
      this.integrityCache.set(catalogId, 'modified');
      return result;
    }

    let currentHash: string;
    try {
      currentHash = hashDirectoryContents(skillPath);
    } catch (error) {
      logWarn(`[Marketplace] Integrity hash failed for ${catalogId}:`, error);
      const result: MarketplaceIntegrityResult = {
        catalogId,
        status: 'unverified',
        pinnedSha: record.pinnedSha,
        contentHash: record.contentHash,
      };
      this.integrityCache.set(catalogId, 'unverified');
      return result;
    }

    const status: SkillIntegrityStatus =
      currentHash === record.contentHash ? 'ok' : 'modified';
    this.integrityCache.set(catalogId, status);
    return {
      catalogId,
      status,
      pinnedSha: record.pinnedSha,
      contentHash: record.contentHash,
    };
  }

  /**
   * Silent startup check: verify every pinned skill and cache warning badges.
   * Never throws; never blocks app startup.
   */
  async verifyAllPinnedSkills(): Promise<void> {
    const records = marketplaceInstalledStore
      .list()
      .filter((record) => record.type === 'skill' && record.contentHash && record.pinnedSha);

    for (const record of records) {
      try {
        await this.verifyIntegrity(record.catalogId);
      } catch (error) {
        logWarn(`[Marketplace] Startup integrity check failed for ${record.catalogId}:`, error);
        this.integrityCache.set(record.catalogId, 'unverified');
      }
    }
  }

  async uninstall(catalogId: string): Promise<MarketplaceUninstallResult> {
    const entry = await catalogAggregator.getEntry(catalogId);
    // Fall back on the installed record so items whose catalog source was
    // removed can still be uninstalled.
    const record = marketplaceInstalledStore.get(catalogId);
    const target = entry ?? (record ? { id: record.catalogId, type: record.type } : undefined);
    if (!target) {
      return { success: false };
    }
    const installedRef = record?.installedRef;
    await this.installResolver.uninstall(target);
    this.integrityCache.delete(catalogId);
    return { success: true, type: target.type, installedRef };
  }

  async setEnabled(catalogId: string, enabled: boolean): Promise<{ success: boolean }> {
    const entry = await catalogAggregator.getEntry(catalogId);
    if (!entry) {
      return { success: false };
    }
    await this.installResolver.setEnabled(entry, enabled);
    return { success: true };
  }

  async getMeta(forceRefresh = false): Promise<CatalogManifestMeta> {
    return catalogAggregator.getMeta(forceRefresh);
  }

  async listSources(forceRefresh = false): Promise<CatalogSourceStatus[]> {
    return catalogAggregator.getSourceStatuses(forceRefresh);
  }

  async addSource(url: string, name?: string): Promise<CatalogSourceStatus> {
    const trimmedUrl = url.trim();
    let parsed: URL;
    try {
      parsed = new URL(trimmedUrl);
    } catch {
      throw new Error(`Invalid catalog URL: ${trimmedUrl}`);
    }
    if (parsed.protocol !== 'https:') {
      throw new Error('Catalog sources must use https://');
    }

    const id = catalogSourceIdForUrl(trimmedUrl);
    if (catalogSourcesStore.get(id)) {
      throw new Error('This catalog source is already added');
    }

    // Preflight: reject sources whose manifest cannot be fetched or validated.
    const manifest = await catalogAggregator.fetchExternalManifest(trimmedUrl);

    const source = {
      id,
      name: name?.trim() || parsed.hostname,
      url: trimmedUrl,
      addedAt: Date.now(),
    };
    catalogSourcesStore.save(source);
    catalogAggregator.invalidateSourceCache(id);

    return {
      ...source,
      state: 'ok',
      entryCount: manifest.entries.filter((entry) => entry.deprecated !== true).length,
      fetchedAt: Date.now(),
    };
  }

  async removeSource(sourceId: string): Promise<{ success: boolean }> {
    const removed = catalogSourcesStore.remove(sourceId);
    if (removed) {
      catalogAggregator.invalidateSourceCache(sourceId);
    }
    return { success: removed };
  }

  private async resolveInstalledSkillPath(installedRef: string): Promise<string | null> {
    const skills = await this.skillsManager.listSkills();
    const skill = skills.find((item) => item.id === installedRef);
    if (!skill) {
      return null;
    }

    const byName = path.join(this.skillsManager.getGlobalSkillsPath(), skill.name);
    if (fs.existsSync(byName) && fs.statSync(byName).isDirectory()) {
      return byName;
    }

    const folderFromId = installedRef.replace(/^(global|custom)-/, '');
    if (folderFromId && folderFromId !== skill.name) {
      const byId = path.join(this.skillsManager.getGlobalSkillsPath(), folderFromId);
      if (fs.existsSync(byId) && fs.statSync(byId).isDirectory()) {
        return byId;
      }
    }

    return null;
  }

  private toMarketplaceEntry(
    entry: CatalogEntry,
    skills: Awaited<ReturnType<SkillsManager['listSkills']>>,
    mcpServers: ReturnType<typeof mcpConfigStore.getServers>,
    plugins: ReturnType<PluginRuntimeService['listInstalled']>
  ): MarketplaceEntry {
    const record = marketplaceInstalledStore.get(entry.id);
    let installState: MarketplaceEntry['installState'] = 'not_installed';
    let enabled = false;
    let installedRef: string | undefined;

    if (record) {
      installState = 'installed';
      installedRef = record.installedRef;
      if (entry.type === 'skill') {
        const skill = skills.find((item) => item.id === record.installedRef);
        enabled = skill?.enabled ?? false;
      } else if (entry.type === 'mcp') {
        const server = mcpServers.find((item) => item.id === record.installedRef);
        enabled = server?.enabled ?? false;
      } else if (entry.type === 'plugin') {
        const plugin = plugins.find((item) => item.pluginId === record.installedRef);
        enabled = plugin?.enabled ?? false;
      }
    } else if (entry.type === 'skill' && entry.resolve.via === 'builtin') {
      const folderName = entry.resolve.path;
      const builtin = skills.find((skill) => skill.id === `builtin-${folderName}`);
      if (builtin) {
        installState = 'builtin';
        installedRef = builtin.id;
        enabled = builtin.enabled;
      }
    } else if (entry.type === 'mcp' && entry.resolve.via === 'preset') {
      const presetServer = mcpServers.find((server) => server.id === `marketplace-${entry.id}`);
      if (presetServer) {
        installState = 'installed';
        installedRef = presetServer.id;
        enabled = presetServer.enabled;
      }
    }

    const pinnedSha = record?.pinnedSha;
    let integrityStatus: SkillIntegrityStatus | undefined;
    if (record?.type === 'skill' && (record.contentHash || record.pinnedSha)) {
      integrityStatus = this.integrityCache.get(entry.id) ?? 'unverified';
    }

    return {
      ...entry,
      installState,
      enabled,
      installedRef,
      deprecated: entry.deprecated === true,
      ...(pinnedSha ? { pinnedSha } : {}),
      ...(integrityStatus ? { integrityStatus } : {}),
    };
  }
}
