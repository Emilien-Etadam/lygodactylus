import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle,
  FolderOpen,
  Globe,
  History,
  Library,
  Loader2,
  Package,
  Plug,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Trash2,
  Undo2,
} from 'lucide-react';
import type {
  CatalogEntryType,
  CatalogManifestMeta,
  CatalogSourceStatus,
  MarketplaceEntry,
  SkillIntegrityStatus,
} from '../../types';
import { SettingsContentSection } from './shared';
import { MarketplaceMcpAdvanced } from './MarketplaceMcpAdvanced';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

type MarketplaceFilter = 'all' | CatalogEntryType;
type MarketplaceView = 'marketplace' | 'installed' | 'sources' | 'storage';

export function SettingsMarketplace({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<MarketplaceEntry[]>([]);
  const [storagePath, setStoragePath] = useState('');
  const [filter, setFilter] = useState<MarketplaceFilter>('all');
  const [view, setView] = useState<MarketplaceView>('marketplace');
  const [isLoading, setIsLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [envTarget, setEnvTarget] = useState<MarketplaceEntry | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [catalogMeta, setCatalogMeta] = useState<CatalogManifestMeta | null>(null);
  const [sources, setSources] = useState<CatalogSourceStatus[]>([]);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceName, setNewSourceName] = useState('');
  const [isAddingSource, setIsAddingSource] = useState(false);

  const loadEntries = useCallback(
    async (forceRefresh = false) => {
      if (!isElectron) {
        return;
      }
      setIsLoading(true);
      try {
        const [catalog, path, meta, sourceList] = await Promise.all([
          window.electronAPI.marketplace.list(forceRefresh),
          window.electronAPI.skills.getStoragePath(),
          window.electronAPI.marketplace.getMeta(forceRefresh),
          window.electronAPI.marketplace.listSources(forceRefresh),
        ]);
        setEntries(catalog);
        setStoragePath(path || '');
        setCatalogMeta(meta);
        setSources(sourceList);
        setError('');
        if (forceRefresh && meta.source === 'remote') {
          setSuccess(t('marketplace.catalogUpdated'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('marketplace.failedToLoad'));
      } finally {
        setIsLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    if (isActive) {
      void loadEntries(true);
    }
  }, [isActive, loadEntries]);

  const filteredEntries = useMemo(() => {
    let list = entries;
    if (view === 'installed') {
      list = list.filter(
        (entry) => entry.installState === 'installed' || entry.installState === 'builtin'
      );
    }
    if (filter === 'all') {
      return list;
    }
    return list.filter((entry) => entry.type === filter);
  }, [entries, filter, view]);

  async function handleInstall(entry: MarketplaceEntry) {
    if (!isElectron) {
      return;
    }
    if (entry.requiresEnv?.length) {
      const initial: Record<string, string> = {};
      for (const key of entry.requiresEnv) {
        initial[key] = envValues[key] || '';
      }
      setEnvValues(initial);
      setEnvTarget(entry);
      return;
    }
    await runInstall(entry.id);
  }

  async function runInstall(catalogId: string, env?: Record<string, string>) {
    if (!isElectron) {
      return;
    }
    setActionId(catalogId);
    setError('');
    try {
      const result = await window.electronAPI.marketplace.install(catalogId, env);
      setSuccess(t('marketplace.installSuccess', { name: result.name }));
      setEnvTarget(null);
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('marketplace.installFailed'));
    } finally {
      setActionId(null);
    }
  }

  async function handleToggle(entry: MarketplaceEntry) {
    if (!isElectron) {
      return;
    }
    setActionId(entry.id);
    try {
      await window.electronAPI.marketplace.setEnabled(entry.id, !entry.enabled);
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('marketplace.toggleFailed'));
    } finally {
      setActionId(null);
    }
  }

  async function handleUninstall(entry: MarketplaceEntry) {
    if (!isElectron) {
      return;
    }
    if (!confirm(t('marketplace.uninstallConfirm', { name: entry.name }))) {
      return;
    }
    setActionId(entry.id);
    try {
      await window.electronAPI.marketplace.uninstall(entry.id);
      setSuccess(t('marketplace.uninstallSuccess', { name: entry.name }));
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('marketplace.uninstallFailed'));
    } finally {
      setActionId(null);
    }
  }

  async function handleVerifyIntegrity(entry: MarketplaceEntry) {
    if (!isElectron) {
      return;
    }
    setActionId(entry.id);
    setError('');
    try {
      const result = await window.electronAPI.marketplace.verifyIntegrity(entry.id);
      if (result.status === 'ok') {
        setSuccess(t('marketplace.verifyIntegritySuccess', { name: entry.name }));
      } else if (result.status === 'modified') {
        setError(t('marketplace.verifyIntegrityModified', { name: entry.name }));
      } else {
        setSuccess(t('marketplace.verifyIntegrityUnverified', { name: entry.name }));
      }
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('marketplace.verifyIntegrityFailed'));
    } finally {
      setActionId(null);
    }
  }

  async function handleUpdate(entry: MarketplaceEntry) {
    if (!isElectron) {
      return;
    }
    setActionId(entry.id);
    setError('');
    try {
      const result = await window.electronAPI.marketplace.update(entry.id);
      const shortSha = result.pinnedSha ? result.pinnedSha.slice(0, 7) : '';
      setSuccess(
        shortSha
          ? t('marketplace.updateSuccessPinned', { name: result.name, sha: shortSha })
          : t('marketplace.updateSuccess', { name: result.name })
      );
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('marketplace.updateFailed'));
    } finally {
      setActionId(null);
    }
  }

  async function handleRollback(entry: MarketplaceEntry) {
    if (!isElectron) {
      return;
    }
    const shortSha = entry.pinnedSha ? entry.pinnedSha.slice(0, 7) : '';
    if (!confirm(t('marketplace.rollbackConfirm', { name: entry.name, sha: shortSha }))) {
      return;
    }
    setActionId(entry.id);
    setError('');
    try {
      const result = await window.electronAPI.marketplace.rollback(entry.id);
      setSuccess(t('marketplace.rollbackSuccess', { name: result.name, sha: shortSha }));
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('marketplace.rollbackFailed'));
    } finally {
      setActionId(null);
    }
  }

  async function handleAddSource() {
    if (!isElectron || !newSourceUrl.trim()) {
      return;
    }
    setIsAddingSource(true);
    setError('');
    try {
      const status = await window.electronAPI.marketplace.addSource(
        newSourceUrl,
        newSourceName.trim() || undefined
      );
      setSuccess(t('marketplace.sourceAdded', { name: status.name, count: status.entryCount }));
      setNewSourceUrl('');
      setNewSourceName('');
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('marketplace.sourceAddFailed'));
    } finally {
      setIsAddingSource(false);
    }
  }

  async function handleRemoveSource(source: CatalogSourceStatus) {
    if (!isElectron) {
      return;
    }
    if (!confirm(t('marketplace.sourceRemoveConfirm', { name: source.name }))) {
      return;
    }
    setActionId(source.id);
    setError('');
    try {
      await window.electronAPI.marketplace.removeSource(source.id);
      setSuccess(t('marketplace.sourceRemoved', { name: source.name }));
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('marketplace.sourceRemoveFailed'));
    } finally {
      setActionId(null);
    }
  }

  async function handleInstallFromFolder() {
    if (!isElectron) {
      return;
    }
    const folderPath = await window.electronAPI.invoke<string | null>({
      type: 'folder.select',
      payload: {},
    });
    if (!folderPath) {
      return;
    }
    setIsLoading(true);
    try {
      const validation = await window.electronAPI.skills.validate(folderPath);
      if (!validation.valid) {
        setError(validation.errors.join(', '));
        return;
      }
      await window.electronAPI.skills.install(folderPath);
      setSuccess(t('marketplace.manualSkillSuccess'));
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('marketplace.installFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectStoragePath() {
    if (!isElectron) {
      return;
    }
    const folderPath = await window.electronAPI.invoke<string | null>({
      type: 'folder.select',
      payload: {},
    });
    if (!folderPath) {
      return;
    }
    try {
      const result = await window.electronAPI.skills.setStoragePath(folderPath, true);
      setStoragePath(result.path);
      setSuccess(
        t('skills.storagePathUpdated', {
          migrated: result.migratedCount,
          skipped: result.skippedCount,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('skills.storagePathUpdateFailed'));
    }
  }

  async function handleOpenStoragePath() {
    if (!isElectron) {
      return;
    }
    const result = await window.electronAPI.skills.openStoragePath();
    if (!result.success) {
      setError(result.error || t('skills.storagePathOpenFailed'));
    }
  }

  const filterButtons: Array<{ id: MarketplaceFilter; label: string }> = [
    { id: 'all', label: t('marketplace.filterAll') },
    { id: 'skill', label: t('marketplace.filterSkills') },
    { id: 'mcp', label: t('marketplace.filterMcp') },
    { id: 'plugin', label: t('marketplace.filterPlugins') },
  ];

  const viewButtons: Array<{ id: MarketplaceView; label: string }> = [
    { id: 'marketplace', label: t('marketplace.viewMarketplace') },
    { id: 'installed', label: t('marketplace.viewInstalled') },
    { id: 'sources', label: t('marketplace.viewSources') },
    { id: 'storage', label: t('marketplace.viewStorage') },
  ];

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-success/10 text-success text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {catalogMeta && view !== 'storage' && view !== 'sources' && (
        <div className="text-xs text-text-muted rounded-lg border border-border px-3 py-2 space-y-1">
          <div>
            {t('marketplace.catalogMeta', {
              version: catalogMeta.version,
              updatedAt: new Date(catalogMeta.updatedAt).toLocaleDateString(),
              count: catalogMeta.entryCount,
            })}
          </div>
          <div>
            {catalogMeta.source === 'remote'
              ? t('marketplace.catalogSourceRemote')
              : t('marketplace.catalogSourceBundled')}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {viewButtons.map((button) => (
          <button
            key={button.id}
            onClick={() => setView(button.id)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              view === button.id
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-text-secondary hover:border-accent/40'
            }`}
          >
            {button.label}
          </button>
        ))}
        <button
          onClick={() => void loadEntries(true)}
          disabled={isLoading}
          className="ml-auto px-3 py-1.5 rounded-lg border border-border text-sm text-text-secondary hover:border-accent/40 inline-flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          {t('marketplace.refresh')}
        </button>
      </div>

      {view !== 'storage' && view !== 'sources' && (
        <div className="flex flex-wrap gap-2">
          {filterButtons.map((button) => (
            <button
              key={button.id}
              onClick={() => setFilter(button.id)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                filter === button.id
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border text-text-secondary hover:border-accent/40'
              }`}
            >
              {button.label}
            </button>
          ))}
        </div>
      )}

      {view === 'storage' ? (
        <SettingsContentSection
          title={t('skills.storagePathTitle')}
          description={t('skills.storagePathHint')}
        >
          <div className="text-xs text-text-muted break-all">
            {storagePath || t('skills.storagePathUnavailable')}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <button
              onClick={() => void handleSelectStoragePath()}
              className="w-full py-2.5 px-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent"
            >
              <FolderOpen className="w-4 h-4" />
              {t('skills.selectStoragePath')}
            </button>
            <button
              onClick={() => void handleOpenStoragePath()}
              className="w-full py-2.5 px-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent"
            >
              <Globe className="w-4 h-4" />
              {t('skills.openStoragePath')}
            </button>
          </div>
        </SettingsContentSection>
      ) : view === 'sources' ? (
        <SettingsContentSection
          title={t('marketplace.sourcesTitle')}
          description={t('marketplace.sourcesDesc')}
        >
          <div className="flex items-start gap-2 text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{t('marketplace.sourcesWarning')}</span>
          </div>

          <div className="space-y-2">
            {sources.map((source) => (
              <div
                key={source.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background-secondary/50 p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Library className="w-4 h-4 text-accent flex-shrink-0" />
                    <span className="font-medium text-text-primary truncate">{source.name}</span>
                  </div>
                  <div className="mt-1 text-xs text-text-muted break-all">{source.url}</div>
                  <div className="mt-1 text-xs">
                    {source.state === 'ok' ? (
                      <span className="text-success">
                        {t('marketplace.sourceEntryCount', { count: source.entryCount })}
                      </span>
                    ) : (
                      <span className="text-error">
                        {t('marketplace.sourceError', { error: source.error || '' })}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => void handleRemoveSource(source)}
                  disabled={actionId === source.id || isLoading}
                  className="px-3 py-1.5 rounded-lg border border-error/30 text-error text-sm inline-flex items-center gap-2 disabled:opacity-50 flex-shrink-0"
                >
                  {actionId === source.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  {t('marketplace.sourceRemove')}
                </button>
              </div>
            ))}
            {sources.length === 0 && (
              <p className="text-sm text-text-muted">{t('marketplace.sourceEmpty')}</p>
            )}
          </div>

          <div className="space-y-2">
            <input
              type="text"
              value={newSourceUrl}
              onChange={(event) => setNewSourceUrl(event.target.value)}
              placeholder={t('marketplace.sourceUrlPlaceholder')}
              className="w-full rounded-lg border border-border bg-background-secondary px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={newSourceName}
              onChange={(event) => setNewSourceName(event.target.value)}
              placeholder={t('marketplace.sourceNamePlaceholder')}
              className="w-full rounded-lg border border-border bg-background-secondary px-3 py-2 text-sm"
            />
            <button
              onClick={() => void handleAddSource()}
              disabled={isAddingSource || !newSourceUrl.trim()}
              className="w-full py-2.5 px-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent disabled:opacity-50"
            >
              {isAddingSource ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              {t('marketplace.sourceAdd')}
            </button>
          </div>
        </SettingsContentSection>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredEntries.map((entry) => (
              <MarketplaceCard
                key={entry.id}
                entry={entry}
                isBusy={actionId === entry.id || isLoading}
                onInstall={() => void handleInstall(entry)}
                onToggle={() => void handleToggle(entry)}
                onUninstall={() => void handleUninstall(entry)}
                onVerifyIntegrity={() => void handleVerifyIntegrity(entry)}
                onUpdate={() => void handleUpdate(entry)}
                onRollback={() => void handleRollback(entry)}
              />
            ))}
          </div>
          {filteredEntries.length === 0 && !isLoading && (
            <p className="text-sm text-text-muted">{t('marketplace.empty')}</p>
          )}
        </>
      )}

      {view === 'marketplace' && (
        <SettingsContentSection
          title={t('marketplace.manualTitle')}
          description={t('marketplace.manualDesc')}
        >
          <div className="flex items-start gap-2 text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{t('marketplace.manualWarning')}</span>
          </div>
          <button
            onClick={() => void handleInstallFromFolder()}
            disabled={isLoading}
            className="w-full py-2.5 px-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent disabled:opacity-50"
          >
            <FolderOpen className="w-4 h-4" />
            {t('marketplace.manualSkillInstall')}
          </button>
          <MarketplaceMcpAdvanced isActive={isActive && view === 'marketplace'} />
        </SettingsContentSection>
      )}

      {envTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 space-y-4">
            <h4 className="text-lg font-semibold text-text-primary">
              {t('marketplace.envTitle', { name: envTarget.name })}
            </h4>
            {(envTarget.requiresEnv || []).map((key) => (
              <label key={key} className="block space-y-1">
                <span className="text-sm text-text-secondary">{key}</span>
                {envTarget.envDescription?.[key] && (
                  <span className="block text-xs text-text-muted">
                    {envTarget.envDescription[key]}
                  </span>
                )}
                <input
                  type="password"
                  value={envValues[key] || ''}
                  onChange={(event) =>
                    setEnvValues((current) => ({ ...current, [key]: event.target.value }))
                  }
                  className="w-full rounded-lg border border-border bg-background-secondary px-3 py-2 text-sm"
                />
              </label>
            ))}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEnvTarget(null)}
                className="px-3 py-2 rounded-lg border border-border text-sm"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => void runInstall(envTarget.id, envValues)}
                className="px-3 py-2 rounded-lg bg-accent text-white text-sm"
              >
                {t('marketplace.install')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function IntegrityBadge({ status }: { status: SkillIntegrityStatus }) {
  const { t } = useTranslation();
  if (status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <ShieldCheck className="w-3 h-3" />
        {t('marketplace.integrityOk')}
      </span>
    );
  }
  if (status === 'modified') {
    return (
      <span className="inline-flex items-center gap-1 text-warning">
        <ShieldAlert className="w-3 h-3" />
        {t('marketplace.integrityModified')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-text-muted">
      <ShieldQuestion className="w-3 h-3" />
      {t('marketplace.integrityUnverified')}
    </span>
  );
}

function MarketplaceCard({
  entry,
  isBusy,
  onInstall,
  onToggle,
  onUninstall,
  onVerifyIntegrity,
  onUpdate,
  onRollback,
}: {
  entry: MarketplaceEntry;
  isBusy: boolean;
  onInstall: () => void;
  onToggle: () => void;
  onUninstall: () => void;
  onVerifyIntegrity: () => void;
  onUpdate: () => void;
  onRollback: () => void;
}) {
  const { t } = useTranslation();
  const isInstalled = entry.installState === 'installed' || entry.installState === 'builtin';
  const TypeIcon = entry.type === 'mcp' ? Plug : Package;
  const isGithubSkill =
    entry.type === 'skill' && entry.resolve.via === 'github' && entry.installState === 'installed';
  const hasPin = Boolean(entry.pinnedSha);

  return (
    <div className="rounded-xl border border-border bg-background-secondary/50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <TypeIcon className="w-4 h-4 text-accent flex-shrink-0" />
            <h4 className="font-medium text-text-primary truncate">{entry.name}</h4>
            {entry.integrityStatus === 'modified' && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-warning/10 text-warning text-[11px] px-2 py-1 flex-shrink-0"
                title={t('marketplace.integrityModified')}
              >
                <ShieldAlert className="w-3 h-3" />
                {t('marketplace.integrityModified')}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-text-muted line-clamp-3">{entry.description}</p>
        </div>
        {entry.sourceId ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-warning/10 text-warning text-[11px] px-2 py-1 flex-shrink-0"
            title={t('marketplace.unverifiedBadgeHint', { source: entry.sourceName || '' })}
          >
            <ShieldAlert className="w-3 h-3" />
            {t('marketplace.unverifiedBadge')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 text-success text-[11px] px-2 py-1 flex-shrink-0">
            <ShieldCheck className="w-3 h-3" />
            {t('marketplace.verifiedBadge')}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
        <span className="uppercase tracking-wide">{entry.type}</span>
        {entry.sourceName && <span className="truncate">{entry.sourceName}</span>}
        {entry.deprecated && <span className="text-warning">{t('marketplace.deprecated')}</span>}
        {entry.pinnedSha && (
          <span className="font-mono text-text-secondary">
            {t('marketplace.pinnedTo', { sha: shortSha(entry.pinnedSha) })}
          </span>
        )}
        {entry.integrityStatus && <IntegrityBadge status={entry.integrityStatus} />}
      </div>

      <div className="flex flex-wrap gap-2">
        {!isInstalled ? (
          <button
            onClick={onInstall}
            disabled={isBusy || entry.deprecated}
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm inline-flex items-center gap-2 disabled:opacity-50"
          >
            {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {t('marketplace.install')}
          </button>
        ) : (
          <>
            <button
              onClick={onToggle}
              disabled={isBusy}
              className="px-3 py-1.5 rounded-lg border border-border text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              {entry.enabled ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
              {entry.enabled ? t('marketplace.disable') : t('marketplace.enable')}
            </button>
            {isGithubSkill && (
              <>
                <button
                  onClick={onVerifyIntegrity}
                  disabled={isBusy}
                  className="px-3 py-1.5 rounded-lg border border-border text-sm inline-flex items-center gap-2 disabled:opacity-50"
                >
                  <ShieldCheck className="w-4 h-4" />
                  {t('marketplace.verifyIntegrity')}
                </button>
                <button
                  onClick={onUpdate}
                  disabled={isBusy}
                  className="px-3 py-1.5 rounded-lg border border-border text-sm inline-flex items-center gap-2 disabled:opacity-50"
                >
                  <History className="w-4 h-4" />
                  {t('marketplace.update')}
                </button>
                {hasPin && (
                  <button
                    onClick={onRollback}
                    disabled={isBusy}
                    className="px-3 py-1.5 rounded-lg border border-border text-sm inline-flex items-center gap-2 disabled:opacity-50"
                  >
                    <Undo2 className="w-4 h-4" />
                    {t('marketplace.rollback')}
                  </button>
                )}
              </>
            )}
            {entry.installState === 'installed' && (
              <button
                onClick={onUninstall}
                disabled={isBusy}
                className="px-3 py-1.5 rounded-lg border border-error/30 text-error text-sm inline-flex items-center gap-2 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                {t('marketplace.uninstall')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
