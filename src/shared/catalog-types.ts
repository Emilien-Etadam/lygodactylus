export type CatalogEntryType = 'skill' | 'mcp' | 'plugin';

export type ResolveVia = 'builtin' | 'preset' | 'mcp-registry' | 'github';

export interface BuiltinResolveSpec {
  via: 'builtin';
  path: string;
}

export interface PresetResolveSpec {
  via: 'preset';
  presetKey: string;
}

export interface McpRegistryResolveSpec {
  via: 'mcp-registry';
  mcpServerName: string;
  pinVersion?: string;
  presetFallback?: string;
}

export interface GithubResolveSpec {
  via: 'github';
  repo: string;
  subdir: string;
  ref: string;
}

export type ResolveSpec =
  | BuiltinResolveSpec
  | PresetResolveSpec
  | McpRegistryResolveSpec
  | GithubResolveSpec;

export interface CatalogEntry {
  id: string;
  type: CatalogEntryType;
  name: string;
  description: string;
  verified: boolean;
  resolve: ResolveSpec;
  requiresEnv?: string[];
  envDescription?: Record<string, string>;
  deprecated?: boolean;
  deprecationMessage?: string;
  /** Set on entries coming from a user-added catalog source; absent for the official catalog. */
  sourceId?: string;
  sourceName?: string;
}

export interface CatalogManifest {
  version: string;
  updatedAt: string;
  policy: string;
  entries: CatalogEntry[];
}

/** A user-added third-party catalog (URL pointing to a manifest.json). */
export interface CatalogSource {
  id: string;
  name: string;
  url: string;
  addedAt: number;
}

export interface CatalogSourceStatus extends CatalogSource {
  state: 'ok' | 'error';
  entryCount: number;
  error?: string;
  fetchedAt?: number;
}

export type CatalogManifestSource = 'remote' | 'bundled';

export interface CatalogManifestMeta {
  source: CatalogManifestSource;
  version: string;
  updatedAt: string;
  entryCount: number;
  fetchedAt: number;
  remoteUrl: string;
}

export type MarketplaceInstallState = 'not_installed' | 'installed' | 'builtin';

export interface MarketplaceEntry extends CatalogEntry {
  installState: MarketplaceInstallState;
  enabled: boolean;
  installedRef?: string;
  deprecated: boolean;
}

export interface MarketplaceInstallResult {
  catalogId: string;
  type: CatalogEntryType;
  name: string;
  installedRef?: string;
  warnings?: string[];
}

export interface MarketplaceInstalledRecord {
  catalogId: string;
  type: CatalogEntryType;
  installedRef: string;
  installedAt: number;
  env?: Record<string, string>;
}
