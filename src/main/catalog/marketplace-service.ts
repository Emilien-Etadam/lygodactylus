import type {
  CatalogEntry,
  CatalogEntryType,
  CatalogManifestMeta,
  CatalogSourceStatus,
  MarketplaceEntry,
  MarketplaceInstallResult,
} from '../../shared/catalog-types';
import type { SkillsManager } from '../skills/skills-manager';
import type { PluginRuntimeService } from '../skills/plugin-runtime-service';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import { catalogAggregator } from './catalog-aggregator';
import { catalogSourceIdForUrl, catalogSourcesStore } from './catalog-sources-store';
import { InstallResolver } from './install-resolver';
import { marketplaceInstalledStore } from './marketplace-installed-store';

export interface MarketplaceUninstallResult {
  success: boolean;
  type?: CatalogEntryType;
  installedRef?: string;
}

export class MarketplaceService {
  private readonly installResolver: InstallResolver;

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
    return this.installResolver.install(entry, envValues);
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

    return {
      ...entry,
      installState,
      enabled,
      installedRef,
      deprecated: entry.deprecated === true,
    };
  }
}
