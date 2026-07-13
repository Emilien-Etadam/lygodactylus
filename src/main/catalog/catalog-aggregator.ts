import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import type {
  CatalogEntry,
  CatalogManifest,
  CatalogManifestMeta,
  CatalogSource,
  CatalogSourceStatus,
} from '../../shared/catalog-types';
import { validateCatalogManifest } from '../../shared/catalog-manifest-validator';
import { catalogSourcesStore } from './catalog-sources-store';
import { log, logWarn } from '../utils/logger';

export const REMOTE_MANIFEST_URL =
  'https://raw.githubusercontent.com/Emilien-Etadam/lygodactylus/main/catalog/manifest.json';
const CACHE_TTL_MS = 60 * 60 * 1000;

// Entries from user-added catalogs are namespaced "<sourceId>/<entryId>" so they can
// never collide with official ids (which cannot contain "/").
export const EXTERNAL_ID_SEPARATOR = '/';

interface CachedManifest {
  expiresAt: number;
  manifest: CatalogManifest;
  meta: CatalogManifestMeta;
}

interface CachedSourceManifest {
  expiresAt: number;
  manifest: CatalogManifest | null;
  status: CatalogSourceStatus;
}

export class CatalogAggregator {
  private cache: CachedManifest | null = null;
  private sourceCache = new Map<string, CachedSourceManifest>();
  private readonly fetchFn: typeof fetch;
  private readonly sourcesProvider: () => CatalogSource[];

  constructor(
    fetchFn: typeof fetch = fetch,
    sourcesProvider: () => CatalogSource[] = () => catalogSourcesStore.list()
  ) {
    this.fetchFn = fetchFn;
    this.sourcesProvider = sourcesProvider;
  }

  async listVerifiedEntries(forceRefresh = false): Promise<CatalogEntry[]> {
    const loaded = await this.loadManifest(forceRefresh);
    return loaded.manifest.entries.filter(
      (entry) => entry.verified === true && entry.deprecated !== true
    );
  }

  /** Official verified entries followed by entries from every user-added catalog source. */
  async listAllEntries(forceRefresh = false): Promise<CatalogEntry[]> {
    const official = await this.listVerifiedEntries(forceRefresh);
    const external = await this.listExternalEntries(forceRefresh);
    return [...official, ...external];
  }

  async getEntry(catalogId: string, forceRefresh = false): Promise<CatalogEntry | undefined> {
    const separatorIndex = catalogId.indexOf(EXTERNAL_ID_SEPARATOR);
    if (separatorIndex > 0) {
      const sourceId = catalogId.slice(0, separatorIndex);
      const source = this.sourcesProvider().find((item) => item.id === sourceId);
      if (!source) {
        return undefined;
      }
      const entries = await this.listSourceEntries(source, forceRefresh);
      return entries.find((entry) => entry.id === catalogId);
    }
    const loaded = await this.loadManifest(forceRefresh);
    return loaded.manifest.entries.find((entry) => entry.id === catalogId);
  }

  async getMeta(forceRefresh = false): Promise<CatalogManifestMeta> {
    const cached = await this.loadManifest(forceRefresh);
    return cached.meta;
  }

  async getSourceStatuses(forceRefresh = false): Promise<CatalogSourceStatus[]> {
    const sources = this.sourcesProvider();
    const statuses: CatalogSourceStatus[] = [];
    for (const source of sources) {
      const cached = await this.loadSourceManifest(source, forceRefresh);
      statuses.push(cached.status);
    }
    return statuses;
  }

  /** Fetch and validate a third-party manifest without persisting anything (add preflight). */
  async fetchExternalManifest(url: string): Promise<CatalogManifest> {
    const response = await this.fetchFn(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new Error('Manifest is not valid JSON');
    }
    const validation = validateCatalogManifest(parsed, 'external');
    if (!validation.valid) {
      throw new Error(`Manifest failed validation: ${validation.errors.join('; ')}`);
    }
    return parsed as CatalogManifest;
  }

  /** Drop cached data for a source (or all sources) after add/remove. */
  invalidateSourceCache(sourceId?: string): void {
    if (sourceId) {
      this.sourceCache.delete(sourceId);
    } else {
      this.sourceCache.clear();
    }
  }

  private async listExternalEntries(forceRefresh: boolean): Promise<CatalogEntry[]> {
    const sources = this.sourcesProvider();
    const entries: CatalogEntry[] = [];
    for (const source of sources) {
      entries.push(...(await this.listSourceEntries(source, forceRefresh)));
    }
    return entries;
  }

  private async listSourceEntries(
    source: CatalogSource,
    forceRefresh: boolean
  ): Promise<CatalogEntry[]> {
    const cached = await this.loadSourceManifest(source, forceRefresh);
    if (!cached.manifest) {
      return [];
    }
    return cached.manifest.entries
      .filter((entry) => entry.deprecated !== true)
      .map((entry) => this.toExternalEntry(entry, source));
  }

  private toExternalEntry(entry: CatalogEntry, source: CatalogSource): CatalogEntry {
    return {
      ...entry,
      id: `${source.id}${EXTERNAL_ID_SEPARATOR}${entry.id}`,
      // Third-party manifests cannot self-declare trust.
      verified: false,
      sourceId: source.id,
      sourceName: source.name,
    };
  }

  private async loadSourceManifest(
    source: CatalogSource,
    forceRefresh: boolean
  ): Promise<CachedSourceManifest> {
    const cached = this.sourceCache.get(source.id);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    let next: CachedSourceManifest;
    try {
      const manifest = await this.fetchExternalManifest(source.url);
      next = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        manifest,
        status: {
          ...source,
          state: 'ok',
          entryCount: manifest.entries.filter((entry) => entry.deprecated !== true).length,
          fetchedAt: Date.now(),
        },
      };
      log(`[CatalogAggregator] Loaded external catalog "${source.name}" (${source.url})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(`[CatalogAggregator] External catalog "${source.name}" unavailable:`, message);
      next = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        // Keep the last good manifest so a transient network failure does not
        // empty the marketplace list.
        manifest: cached?.manifest ?? null,
        status: {
          ...source,
          state: 'error',
          entryCount: cached?.manifest
            ? cached.manifest.entries.filter((entry) => entry.deprecated !== true).length
            : 0,
          error: message,
          fetchedAt: cached?.status.fetchedAt,
        },
      };
    }

    this.sourceCache.set(source.id, next);
    return next;
  }

  private async loadManifest(forceRefresh: boolean): Promise<CachedManifest> {
    if (!forceRefresh && this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache;
    }

    const bundled = this.readBundledManifest();
    let manifest = bundled.manifest;
    let meta = bundled.meta;

    try {
      const remote = await this.fetchRemoteManifest();
      if (remote) {
        manifest = remote.manifest;
        meta = remote.meta;
        log('[CatalogAggregator] Loaded remote manifest');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn('[CatalogAggregator] Remote manifest unavailable, using bundled copy:', message);
    }

    this.cache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      manifest,
      meta,
    };
    return this.cache;
  }

  private readBundledManifest(): CachedManifest {
    const candidates = this.getBundledManifestPaths();
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          const raw = fs.readFileSync(candidate, 'utf8');
          const parsed = JSON.parse(raw) as CatalogManifest;
          const validation = validateCatalogManifest(parsed);
          if (validation.valid) {
            return {
              expiresAt: 0,
              manifest: parsed,
              meta: this.buildMeta(parsed, 'bundled'),
            };
          }
        }
      } catch (error) {
        logWarn('[CatalogAggregator] Failed to read bundled manifest:', candidate, error);
      }
    }
    throw new Error('Bundled catalog manifest not found');
  }

  private getBundledManifestPaths(): string[] {
    const appPath = app.getAppPath();
    return [
      path.join(process.resourcesPath || '', 'catalog', 'manifest.json'),
      path.join(__dirname, '..', '..', '..', 'catalog', 'manifest.json'),
      path.join(appPath, 'catalog', 'manifest.json'),
    ];
  }

  private async fetchRemoteManifest(): Promise<CachedManifest | null> {
    const response = await this.fetchFn(REMOTE_MANIFEST_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const parsed = (await response.json()) as CatalogManifest;
    const validation = validateCatalogManifest(parsed);
    if (!validation.valid) {
      throw new Error(`Remote manifest failed validation: ${validation.errors.join('; ')}`);
    }
    return {
      expiresAt: 0,
      manifest: parsed,
      meta: this.buildMeta(parsed, 'remote'),
    };
  }

  private buildMeta(
    manifest: CatalogManifest,
    source: CatalogManifestMeta['source']
  ): CatalogManifestMeta {
    return {
      source,
      version: manifest.version,
      updatedAt: manifest.updatedAt,
      entryCount: manifest.entries.filter((entry) => entry.verified && !entry.deprecated).length,
      fetchedAt: Date.now(),
      remoteUrl: REMOTE_MANIFEST_URL,
    };
  }
}

export const catalogAggregator = new CatalogAggregator();
