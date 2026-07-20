import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppConfig, PiiScrubConfig } from '../../types';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

const DEFAULT_CONFIG: PiiScrubConfig = {
  enabled: false,
  customTerms: [],
};

function mergePiiScrubConfig(config?: PiiScrubConfig): PiiScrubConfig {
  return {
    enabled: config?.enabled === true,
    customTerms: Array.isArray(config?.customTerms)
      ? config.customTerms.filter((term): term is string => typeof term === 'string')
      : [],
  };
}

export function SettingsPiiScrub() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<PiiScrubConfig>(DEFAULT_CONFIG);
  const [termsDraft, setTermsDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isElectron) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    void window.electronAPI.config
      .get()
      .then((appConfig: AppConfig) => {
        if (cancelled) return;
        const next = mergePiiScrubConfig(appConfig.piiScrub);
        setConfig(next);
        setTermsDraft(next.customTerms.join('\n'));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t('common.error'));
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleSave = useCallback(async () => {
    if (!isElectron || isSaving) return;
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      const customTerms = termsDraft
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const next: PiiScrubConfig = {
        enabled: config.enabled,
        customTerms,
      };
      const result = await window.electronAPI.config.save({ piiScrub: next });
      if (result?.config?.piiScrub) {
        const saved = mergePiiScrubConfig(result.config.piiScrub);
        setConfig(saved);
        setTermsDraft(saved.customTerms.join('\n'));
      } else {
        setConfig(next);
      }
      setMessage(t('piiScrub.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setIsSaving(false);
    }
  }, [config.enabled, isSaving, t, termsDraft]);

  if (isLoading) {
    return (
      <section className="rounded-lg border border-border-subtle bg-background px-4 py-4">
        <p className="text-xs text-text-muted">{t('common.loading')}</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border-subtle bg-background px-4 py-4 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-text-primary">{t('piiScrub.title')}</h4>
          <p className="mt-1 text-xs leading-5 text-text-muted">{t('piiScrub.description')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          onClick={() => setConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 flex-shrink-0 ${
            config.enabled ? 'bg-accent' : 'bg-surface-muted'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-text-primary transition-transform ${
              config.enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-text-secondary">{t('piiScrub.customTerms')}</span>
        <textarea
          value={termsDraft}
          onChange={(event) => setTermsDraft(event.target.value)}
          rows={4}
          disabled={!config.enabled}
          placeholder={t('piiScrub.customTermsPlaceholder')}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
        />
        <span className="block text-[11px] leading-4 text-text-muted">
          {t('piiScrub.customTermsHint')}
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {isSaving ? t('common.saving') : t('piiScrub.save')}
        </button>
        {message && <span className="text-xs text-success">{message}</span>}
        {error && <span className="text-xs text-error">{error}</span>}
      </div>
    </section>
  );
}
