import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store';
import { useAppConfig } from '../../store/selectors';
import { formatEeDisplayVersion } from '../../../shared/app-version';
import type { UpdateCheckResult } from '../../../shared/update-check';
import { stopSpeechSynthesis } from '../../utils/speech-synthesis';
import { SettingsChatLan } from './SettingsChatLan';
import { SettingsPiiScrub } from './SettingsPiiScrub';
import { SettingsQuickAsk } from './SettingsQuickAsk';
import { SettingsWebSearch } from './SettingsWebSearch';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

export function SettingsGeneral() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const appConfig = useAppConfig();
  const speechEnabled = appConfig?.speechSynthesisEnabled === true;
  const speechToTextEnabled = appConfig?.speechToTextEnabled === true;
  const speechToTextModel = appConfig?.speechToTextModel === 'small' ? 'small' : 'base';
  const speechToTextLanguage = appConfig?.speechToTextLanguage === 'auto' ? 'auto' : 'ui';
  const modelStatsEnabled = appConfig?.modelStatsEnabled !== false;
  const checkpointsEnabled = appConfig?.checkpointsEnabled !== false;
  const workingDir = useAppStore((s) => s.workingDir);
  const [isSavingSpeech, setIsSavingSpeech] = useState(false);
  const [isSavingStt, setIsSavingStt] = useState(false);
  const [sttStatus, setSttStatus] = useState<Awaited<
    ReturnType<NonNullable<typeof window.electronAPI>['stt']['getStatus']>
  > | null>(null);
  const [sttProgress, setSttProgress] = useState<number | null>(null);
  const [isSttBusy, setIsSttBusy] = useState(false);
  const [isSavingModelStats, setIsSavingModelStats] = useState(false);
  const [isSavingCheckpoints, setIsSavingCheckpoints] = useState(false);
  const [lintCmdDraft, setLintCmdDraft] = useState('');
  const [testCmdDraft, setTestCmdDraft] = useState('');
  const [isSavingTooling, setIsSavingTooling] = useState(false);
  const baseLang = i18n.language.split('-')[0];
  const currentLang = baseLang === 'nb' || baseLang === 'nn' ? 'no' : baseLang;
  const [appVer, setAppVer] = useState('');
  const [updateState, setUpdateState] = useState<UpdateCheckResult | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVer);
      else if (v) setAppVer(v);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.on) {
      return;
    }

    return window.electronAPI.on((event) => {
      if (event.type === 'update.checkResult') {
        setUpdateState(event.payload);
        setIsCheckingUpdate(false);
      }
    });
  }, []);

  const displayVersion = appVer ? formatEeDisplayVersion(appVer) : '';

  const applyUpdateResult = useCallback(
    (result: UpdateCheckResult) => {
      setUpdateState(result);

      if (result.status === 'up-to-date') {
        setUpdateMessage(
          t('general.updateUpToDate', {
            version: formatEeDisplayVersion(result.latestVersion ?? result.currentVersion),
          })
        );
        return;
      }

      if (result.status === 'update-available') {
        setUpdateMessage(
          t('general.updateAvailable', {
            version: formatEeDisplayVersion(result.latestVersion ?? ''),
          })
        );
        return;
      }

      if (result.status === 'downloaded') {
        setUpdateMessage(
          t('general.updateDownloaded', {
            version: formatEeDisplayVersion(result.latestVersion ?? result.currentVersion),
          })
        );
        return;
      }

      if (result.status === 'error') {
        setUpdateMessage(t('general.updateError', { error: result.error ?? t('common.error') }));
      }
    },
    [t]
  );

  const handleCheckForUpdates = useCallback(async () => {
    if (!window.electronAPI?.checkForUpdates) {
      return;
    }

    setIsCheckingUpdate(true);
    setUpdateMessage(t('general.updateChecking'));

    try {
      const result = await window.electronAPI.checkForUpdates();
      applyUpdateResult(result);
    } catch (error) {
      setUpdateMessage(
        t('general.updateError', {
          error: error instanceof Error ? error.message : t('common.error'),
        })
      );
    } finally {
      setIsCheckingUpdate(false);
    }
  }, [applyUpdateResult, t]);

  const handleInstallUpdate = useCallback(async () => {
    if (!window.electronAPI?.installUpdate) {
      return;
    }

    await window.electronAPI.installUpdate();
  }, []);

  const handleOpenReleases = useCallback(async () => {
    if (window.electronAPI?.openReleasesPage) {
      await window.electronAPI.openReleasesPage();
      return;
    }

    await window.electronAPI?.openExternal?.(
      'https://github.com/Emilien-Etadam/lygodactylus/releases/latest'
    );
  }, []);

  const refreshSttStatus = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.stt?.getStatus) return;
    try {
      setSttStatus(await window.electronAPI.stt.getStatus());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshSttStatus();
  }, [refreshSttStatus]);

  useEffect(() => {
    if (!window.electronAPI?.on) return;
    return window.electronAPI.on((event) => {
      if (event.type !== 'stt.progress') return;
      if (typeof event.payload.percent === 'number') {
        setSttProgress(event.payload.percent);
      }
    });
  }, []);

  const handleToggleSpeech = useCallback(async () => {
    if (!isElectron || isSavingSpeech || !window.electronAPI?.config?.save) {
      return;
    }

    const nextEnabled = !speechEnabled;
    setIsSavingSpeech(true);
    try {
      const result = await window.electronAPI.config.save({
        speechSynthesisEnabled: nextEnabled,
      });
      if (result?.config) {
        setAppConfig(result.config);
      }
      if (!nextEnabled) {
        stopSpeechSynthesis();
      }
    } catch {
      // Keep previous value; config.status may still sync later.
    } finally {
      setIsSavingSpeech(false);
    }
  }, [isSavingSpeech, setAppConfig, speechEnabled]);

  const handleToggleStt = useCallback(async () => {
    if (!isElectron || isSavingStt || !window.electronAPI?.config?.save) return;
    const nextEnabled = !speechToTextEnabled;
    setIsSavingStt(true);
    try {
      const result = await window.electronAPI.config.save({
        speechToTextEnabled: nextEnabled,
      });
      if (result?.config) setAppConfig(result.config);
    } catch {
      // keep previous
    } finally {
      setIsSavingStt(false);
    }
  }, [isSavingStt, setAppConfig, speechToTextEnabled]);

  const handleSttModelChange = useCallback(
    async (model: 'base' | 'small') => {
      if (!isElectron || !window.electronAPI?.config?.save) return;
      const result = await window.electronAPI.config.save({ speechToTextModel: model });
      if (result?.config) setAppConfig(result.config);
    },
    [setAppConfig]
  );

  const handleSttLanguageChange = useCallback(
    async (mode: 'auto' | 'ui') => {
      if (!isElectron || !window.electronAPI?.config?.save) return;
      const result = await window.electronAPI.config.save({ speechToTextLanguage: mode });
      if (result?.config) setAppConfig(result.config);
    },
    [setAppConfig]
  );

  const handleSttDownload = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.stt?.ensure || isSttBusy) return;
    setIsSttBusy(true);
    setSttProgress(0);
    try {
      await window.electronAPI.stt.ensure(speechToTextModel);
      await refreshSttStatus();
    } finally {
      setIsSttBusy(false);
      setSttProgress(null);
    }
  }, [isSttBusy, refreshSttStatus, speechToTextModel]);

  const handleSttCancelDownload = useCallback(async () => {
    await window.electronAPI?.stt?.cancelDownload?.();
    setIsSttBusy(false);
    setSttProgress(null);
  }, []);

  const handleSttRemove = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.stt?.remove || isSttBusy) return;
    if (!window.confirm(t('general.speechToTextRemove'))) return;
    setIsSttBusy(true);
    try {
      await window.electronAPI.stt.remove();
      await refreshSttStatus();
    } finally {
      setIsSttBusy(false);
    }
  }, [isSttBusy, refreshSttStatus, t]);

  const handleToggleModelStats = useCallback(async () => {
    if (!isElectron || isSavingModelStats || !window.electronAPI?.config?.save) {
      return;
    }

    const nextEnabled = !modelStatsEnabled;
    setIsSavingModelStats(true);
    try {
      const result = await window.electronAPI.config.save({
        modelStatsEnabled: nextEnabled,
      });
      if (result?.config) {
        setAppConfig(result.config);
      }
    } catch {
      // Keep previous value; config.status may still sync later.
    } finally {
      setIsSavingModelStats(false);
    }
  }, [isSavingModelStats, modelStatsEnabled, setAppConfig]);

  const handleToggleCheckpoints = useCallback(async () => {
    if (!isElectron || isSavingCheckpoints || !window.electronAPI?.config?.save) {
      return;
    }

    const nextEnabled = !checkpointsEnabled;
    setIsSavingCheckpoints(true);
    try {
      const result = await window.electronAPI.config.save({
        checkpointsEnabled: nextEnabled,
      });
      if (result?.config) {
        setAppConfig(result.config);
      }
    } catch {
      // Keep previous value; config.status may still sync later.
    } finally {
      setIsSavingCheckpoints(false);
    }
  }, [checkpointsEnabled, isSavingCheckpoints, setAppConfig]);

  useEffect(() => {
    if (!workingDir) {
      setLintCmdDraft('');
      setTestCmdDraft('');
      return;
    }
    const entry = appConfig?.workspaceTooling?.[workingDir] ?? {};
    setLintCmdDraft(typeof entry.lintCmd === 'string' ? entry.lintCmd : '');
    setTestCmdDraft(typeof entry.testCmd === 'string' ? entry.testCmd : '');
  }, [workingDir, appConfig?.workspaceTooling]);

  const handleSaveWorkspaceTooling = useCallback(async () => {
    if (!isElectron || !workingDir || isSavingTooling || !window.electronAPI?.config?.save) {
      return;
    }
    setIsSavingTooling(true);
    try {
      const nextTooling = { ...(appConfig?.workspaceTooling ?? {}) };
      const lintCmd = lintCmdDraft.trim() || undefined;
      const testCmd = testCmdDraft.trim() || undefined;
      if (!lintCmd && !testCmd) {
        delete nextTooling[workingDir];
      } else {
        nextTooling[workingDir] = { lintCmd, testCmd };
      }
      const result = await window.electronAPI.config.save({
        workspaceTooling: nextTooling,
      });
      if (result?.config) {
        setAppConfig(result.config);
      }
    } catch {
      // Keep drafts; config.status may still sync later.
    } finally {
      setIsSavingTooling(false);
    }
  }, [
    appConfig?.workspaceTooling,
    isSavingTooling,
    lintCmdDraft,
    setAppConfig,
    testCmdDraft,
    workingDir,
  ]);

  const languages = [
    { code: 'en', nativeName: 'English' },
    { code: 'zh', nativeName: '中文' },
    { code: 'es', nativeName: 'Español' },
    { code: 'fr', nativeName: 'Français' },
    { code: 'de', nativeName: 'Deutsch' },
    { code: 'it', nativeName: 'Italiano' },
    { code: 'uk', nativeName: 'Українська' },
    { code: 'pl', nativeName: 'Polski' },
    { code: 'sv', nativeName: 'Svenska' },
    { code: 'no', nativeName: 'Norsk' },
    { code: 'nl', nativeName: 'Nederlands' },
    { code: 'ro', nativeName: 'Română' },
  ];

  const themeOptions = [
    { value: 'light' as const, label: t('general.themeLight') },
    { value: 'dark' as const, label: t('general.themeDark') },
    { value: 'system' as const, label: t('general.themeSystem', 'System') },
  ];

  const canInstallUpdate = Boolean(updateState?.canInstall);
  const showManualDownloadHint =
    updateState?.status === 'update-available' &&
    !canInstallUpdate &&
    !updateState.autoUpdateSupported;
  const showWindowsDownloadFallback =
    updateState?.status === 'update-available' &&
    Boolean(updateState.autoUpdateSupported) &&
    !canInstallUpdate;

  return (
    <div className="space-y-6">
      <SettingsChatLan />
      <SettingsWebSearch />
      <SettingsPiiScrub />
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.appearance')}</h4>
        <div className="flex gap-2">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSettings({ theme: opt.value })}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                settings.theme === opt.value
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.language')}</h4>
        <div className="flex gap-2">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => i18n.changeLanguage(lang.code)}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                currentLang === lang.code
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {lang.nativeName}
            </button>
          ))}
        </div>
      </div>

      <section className="rounded-lg border border-border-subtle bg-background px-4 py-4 space-y-4">
        <h4 className="text-sm font-semibold text-text-primary">{t('general.voiceSection')}</h4>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">{t('general.speechSynthesis')}</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              {t('general.speechSynthesisDesc')}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={speechEnabled}
            onClick={() => void handleToggleSpeech()}
            disabled={isSavingSpeech}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50 flex-shrink-0 ${
              speechEnabled ? 'bg-accent' : 'bg-surface-muted'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-text-primary transition-transform ${
                speechEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="border-t border-border-subtle pt-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary">{t('general.speechToText')}</p>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                {t('general.speechToTextDesc')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={speechToTextEnabled}
              onClick={() => void handleToggleStt()}
              disabled={isSavingStt}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50 flex-shrink-0 ${
                speechToTextEnabled ? 'bg-accent' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-text-primary transition-transform ${
                  speechToTextEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {speechToTextEnabled && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">
                  {t('general.speechToTextModel')}
                </label>
                <div className="flex gap-2">
                  {(
                    [
                      ['base', 'general.speechToTextModelBase'],
                      ['small', 'general.speechToTextModelSmall'],
                    ] as const
                  ).map(([value, labelKey]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => void handleSttModelChange(value)}
                      className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                        speechToTextModel === value
                          ? 'border-accent bg-accent/5 text-text-primary'
                          : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
                      }`}
                    >
                      {t(labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">
                  {t('general.speechToTextLanguage')}
                </label>
                <div className="flex gap-2">
                  {(
                    [
                      ['ui', 'general.speechToTextLanguageUi'],
                      ['auto', 'general.speechToTextLanguageAuto'],
                    ] as const
                  ).map(([value, labelKey]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => void handleSttLanguageChange(value)}
                      className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                        speechToTextLanguage === value
                          ? 'border-accent bg-accent/5 text-text-primary'
                          : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
                      }`}
                    >
                      {t(labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-border-subtle bg-surface/40 px-3 py-2.5 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-text-primary">
                      {t('general.speechToTextRuntime')}
                    </p>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      {sttStatus?.binaryReady &&
                      sttStatus.models[speechToTextModel]?.ready
                        ? t('general.speechToTextRuntimeReady', {
                            version: sttStatus.version,
                          })
                        : t('general.speechToTextRuntimeMissing')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isSttBusy ? (
                      <button
                        type="button"
                        onClick={() => void handleSttCancelDownload()}
                        className="text-xs px-2.5 py-1.5 rounded-md border border-border text-text-secondary hover:bg-surface-hover"
                      >
                        {t('general.speechToTextCancelDownload')}
                      </button>
                    ) : sttStatus?.binaryReady ? (
                      <button
                        type="button"
                        onClick={() => void handleSttRemove()}
                        className="text-xs px-2.5 py-1.5 rounded-md border border-border text-text-secondary hover:bg-surface-hover"
                      >
                        {t('general.speechToTextRemove')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleSttDownload()}
                        className="text-xs px-2.5 py-1.5 rounded-md bg-accent text-background hover:bg-accent-hover"
                      >
                        {t('general.speechToTextDownload')}
                      </button>
                    )}
                  </div>
                </div>
                {isSttBusy && (
                  <p className="text-[11px] text-text-muted flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {t('general.speechToTextDownloading', {
                      percent: sttProgress ?? 0,
                    })}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border-subtle bg-background px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-text-primary">
              {t('general.modelStats')}
            </h4>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              {t('general.modelStatsDesc')}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={modelStatsEnabled}
            onClick={() => void handleToggleModelStats()}
            disabled={isSavingModelStats}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50 flex-shrink-0 ${
              modelStatsEnabled ? 'bg-accent' : 'bg-surface-muted'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-text-primary transition-transform ${
                modelStatsEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-border-subtle bg-background px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-text-primary">
              {t('general.checkpoints')}
            </h4>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              {t('general.checkpointsDesc')}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={checkpointsEnabled}
            onClick={() => void handleToggleCheckpoints()}
            disabled={isSavingCheckpoints}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50 flex-shrink-0 ${
              checkpointsEnabled ? 'bg-accent' : 'bg-surface-muted'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-text-primary transition-transform ${
                checkpointsEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-border-subtle bg-background px-4 py-4 space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-text-primary">
            {t('general.workspaceToolingTitle')}
          </h4>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            {t('general.workspaceToolingHint')}
          </p>
        </div>
        {!workingDir ? (
          <p className="text-xs text-text-muted">{t('general.noWorkspace')}</p>
        ) : (
          <>
            <p className="text-[11px] font-mono text-text-muted truncate" title={workingDir}>
              {workingDir}
            </p>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-text-secondary">{t('general.lintCmd')}</span>
              <input
                type="text"
                value={lintCmdDraft}
                onChange={(e) => setLintCmdDraft(e.target.value)}
                placeholder={t('general.lintCmdPlaceholder')}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-text-secondary">{t('general.testCmd')}</span>
              <input
                type="text"
                value={testCmdDraft}
                onChange={(e) => setTestCmdDraft(e.target.value)}
                placeholder={t('general.testCmdPlaceholder')}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleSaveWorkspaceTooling()}
              disabled={isSavingTooling}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-surface hover:bg-surface-hover text-sm font-medium text-text-primary disabled:opacity-60"
            >
              {isSavingTooling ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {t('general.saveTooling', { defaultValue: 'Save' })}
            </button>
          </>
        )}
      </section>

      <SettingsQuickAsk />

      <div className="space-y-3 pt-4 border-t border-border">
        <h4 className="text-sm font-medium text-text-primary">{t('general.updates')}</h4>
        {displayVersion && (
          <p className="text-sm text-text-secondary">
            {t('general.updateCurrentVersion', { version: displayVersion })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleCheckForUpdates()}
            disabled={isCheckingUpdate}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-surface hover:bg-surface-hover text-sm font-medium text-text-primary disabled:opacity-60"
          >
            {isCheckingUpdate ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {t('general.updateCheck')}
          </button>
          {canInstallUpdate && (
            <button
              type="button"
              onClick={() => void handleInstallUpdate()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-accent bg-accent/10 hover:bg-accent/15 text-sm font-medium text-text-primary"
            >
              <Download className="w-4 h-4" />
              {t('general.updateRestartInstall')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleOpenReleases()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-surface hover:bg-surface-hover text-sm font-medium text-text-secondary"
          >
            {t('general.updateOpenReleases')}
          </button>
        </div>
        {updateMessage && <p className="text-xs text-text-muted">{updateMessage}</p>}
        {updateState?.downloadError && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t('general.updateDownloadError', { error: updateState.downloadError })}
          </p>
        )}
        {showManualDownloadHint && (
          <p className="text-xs text-text-muted">{t('general.updateManualDownload')}</p>
        )}
        {showWindowsDownloadFallback && (
          <p className="text-xs text-text-muted">{t('general.updateManualDownload')}</p>
        )}
      </div>

      {appVer && (
        <div className="pt-2 border-t border-border">
          <p className="text-xs text-text-muted">Lygodactylus {displayVersion}</p>
        </div>
      )}
    </div>
  );
}
