import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type {
  Watcher,
  WatcherCreateInput,
  WatcherRepeatUnit,
  WatcherScheduleConfig,
  WatcherType,
  WatcherUpdateInput,
} from '../../../shared/watch';
import { formatAppDateTime } from '../../utils/i18n-format';
import { SettingsContentSection, renderLocalizedBannerMessage } from './shared';
import type { LocalizedBanner } from './shared';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

type WatchFormMode = 'daily' | 'weekly' | 'interval';

function emptyForm(): {
  type: WatcherType;
  target: string;
  label: string;
  mode: WatchFormMode;
  times: string;
  weekdays: string;
  repeatEvery: number;
  repeatUnit: WatcherRepeatUnit;
  enabled: boolean;
} {
  return {
    type: 'rss',
    target: '',
    label: '',
    mode: 'daily',
    times: '08:00',
    weekdays: '1,2,3,4,5',
    repeatEvery: 1,
    repeatUnit: 'hour',
    enabled: true,
  };
}

function parseTimes(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/)
        .map((part) => part.trim())
        .filter((part) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(part))
    )
  ).sort();
}

function parseWeekdays(raw: string): Array<0 | 1 | 2 | 3 | 4 | 5 | 6> {
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/)
        .map((part) => Number(part.trim()))
        .filter((day): day is 0 | 1 | 2 | 3 | 4 | 5 | 6 => Number.isInteger(day) && day >= 0 && day <= 6)
    )
  ).sort((a, b) => a - b);
}

function buildScheduleFromForm(form: ReturnType<typeof emptyForm>): {
  scheduleConfig: WatcherScheduleConfig | null;
  repeatEvery: number | null;
  repeatUnit: WatcherRepeatUnit | null;
  runAt?: number;
} {
  if (form.mode === 'daily') {
    const times = parseTimes(form.times);
    return {
      scheduleConfig: { kind: 'daily', times },
      repeatEvery: null,
      repeatUnit: null,
    };
  }
  if (form.mode === 'weekly') {
    const times = parseTimes(form.times);
    const weekdays = parseWeekdays(form.weekdays);
    return {
      scheduleConfig: { kind: 'weekly', times, weekdays },
      repeatEvery: null,
      repeatUnit: null,
    };
  }
  return {
    scheduleConfig: null,
    repeatEvery: Math.max(1, Math.floor(form.repeatEvery) || 1),
    repeatUnit: form.repeatUnit,
    runAt: Date.now() + 60 * 60 * 1000,
  };
}

function describeWatcherSchedule(watcher: Watcher, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (watcher.scheduleConfig?.kind === 'daily') {
    return t('watch.ruleDaily', { times: watcher.scheduleConfig.times.join(', ') });
  }
  if (watcher.scheduleConfig?.kind === 'weekly') {
    return t('watch.ruleWeekly', {
      days: watcher.scheduleConfig.weekdays.join(', '),
      times: watcher.scheduleConfig.times.join(', '),
    });
  }
  if (watcher.repeatEvery && watcher.repeatUnit) {
    return t('watch.ruleInterval', {
      every: watcher.repeatEvery,
      unit: t(`watch.unit.${watcher.repeatUnit}`),
    });
  }
  return t('watch.ruleUnknown');
}

export function SettingsWatch({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<LocalizedBanner | null>(null);
  const [success, setSuccess] = useState<LocalizedBanner | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const loadWatchers = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!isElectron || !window.electronAPI?.watch?.list) return;
    const silent = options.silent === true;
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }
    try {
      const rows = await window.electronAPI.watch.list();
      setWatchers(rows);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? { text: err.message } : { key: 'watch.loadFailed' });
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isElectron || !isActive) return;
    void loadWatchers();
  }, [isActive, loadWatchers]);

  useEffect(() => {
    if (!isElectron || !isActive) return;
    const interval = setInterval(() => {
      void loadWatchers({ silent: true });
    }, 5000);
    return () => clearInterval(interval);
  }, [isActive, loadWatchers]);

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm());
  }

  function startEdit(watcher: Watcher) {
    setEditingId(watcher.id);
    const mode: WatchFormMode = watcher.scheduleConfig
      ? watcher.scheduleConfig.kind
      : 'interval';
    setForm({
      type: watcher.type,
      target: watcher.target,
      label: watcher.label,
      mode,
      times: watcher.scheduleConfig?.times.join(', ') ?? '08:00',
      weekdays:
        watcher.scheduleConfig?.kind === 'weekly'
          ? watcher.scheduleConfig.weekdays.join(',')
          : '1,2,3,4,5',
      repeatEvery: watcher.repeatEvery ?? 1,
      repeatUnit: watcher.repeatUnit ?? 'hour',
      enabled: watcher.enabled,
    });
    setError(null);
    setSuccess(null);
  }

  async function submitForm() {
    if (!isElectron || !window.electronAPI?.watch) return;
    const target = form.target.trim();
    if (!target) {
      setError({ key: 'watch.targetRequired' });
      return;
    }
    const schedule = buildScheduleFromForm(form);
    if (form.mode === 'daily' && (!schedule.scheduleConfig || schedule.scheduleConfig.times.length === 0)) {
      setError({ key: 'watch.timesRequired' });
      return;
    }
    if (form.mode === 'weekly') {
      if (
        !schedule.scheduleConfig ||
        schedule.scheduleConfig.kind !== 'weekly' ||
        schedule.scheduleConfig.times.length === 0
      ) {
        setError({ key: 'watch.timesRequired' });
        return;
      }
      if (schedule.scheduleConfig.weekdays.length === 0) {
        setError({ key: 'watch.weekdaysRequired' });
        return;
      }
    }

    setError(null);
    setSuccess(null);
    setIsLoading(true);
    try {
      if (editingId) {
        const updates: WatcherUpdateInput = {
          type: form.type,
          target,
          label: form.label,
          enabled: form.enabled,
          scheduleConfig: schedule.scheduleConfig,
          repeatEvery: schedule.repeatEvery,
          repeatUnit: schedule.repeatUnit,
          runAt: schedule.runAt,
        };
        const updated = await window.electronAPI.watch.update(editingId, updates);
        if (!updated) {
          setError({ key: 'watch.saveFailed' });
          return;
        }
        setSuccess({ key: 'watch.updated' });
      } else {
        const payload: WatcherCreateInput = {
          type: form.type,
          target,
          label: form.label,
          enabled: form.enabled,
          scheduleConfig: schedule.scheduleConfig,
          repeatEvery: schedule.repeatEvery,
          repeatUnit: schedule.repeatUnit,
          runAt: schedule.runAt,
        };
        await window.electronAPI.watch.create(payload);
        setSuccess({ key: 'watch.created' });
      }
      resetForm();
      await loadWatchers();
    } catch (err) {
      setError(err instanceof Error ? { text: err.message } : { key: 'watch.saveFailed' });
    } finally {
      setIsLoading(false);
    }
  }

  async function toggleWatcher(watcher: Watcher) {
    if (!isElectron || !window.electronAPI?.watch) return;
    setError(null);
    setSuccess(null);
    try {
      const updated = await window.electronAPI.watch.toggle(watcher.id, !watcher.enabled);
      if (!updated) {
        setError({ key: 'watch.toggleFailed' });
        return;
      }
      setSuccess({
        key: updated.enabled ? 'watch.watcherEnabled' : 'watch.watcherDisabled',
      });
      await loadWatchers();
    } catch (err) {
      setError(err instanceof Error ? { text: err.message } : { key: 'watch.toggleFailed' });
    }
  }

  async function deleteWatcher(watcher: Watcher) {
    if (!isElectron || !window.electronAPI?.watch?.delete) return;
    if (!window.confirm(t('watch.deleteConfirm', { target: watcher.label || watcher.target }))) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const result = await window.electronAPI.watch.delete(watcher.id);
      if (!result.success) {
        setError({ key: 'watch.deleteFailed' });
        return;
      }
      if (editingId === watcher.id) {
        resetForm();
      }
      setSuccess({ key: 'watch.deleted' });
      await loadWatchers();
    } catch (err) {
      setError(err instanceof Error ? { text: err.message } : { key: 'watch.deleteFailed' });
    }
  }

  return (
    <div className="space-y-6">
      <SettingsContentSection title={t('watch.manageTitle')} description={t('watch.manageDesc')}>
        {error && <p className="text-sm text-error">{renderLocalizedBannerMessage(error, t)}</p>}
        {success && (
          <p className="text-sm text-success">{renderLocalizedBannerMessage(success, t)}</p>
        )}

        <div className="space-y-3 rounded-xl border border-border-muted p-4 bg-surface/40">
          <div className="flex items-center justify-between gap-2">
            <h5 className="text-sm font-medium text-text-primary">
              {editingId ? t('watch.editTitle') : t('watch.createTitle')}
            </h5>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs text-text-muted hover:text-text-primary"
              >
                {t('watch.cancelEdit')}
              </button>
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-text-secondary">{t('watch.fieldType')}</span>
            <select
              value={form.type}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, type: event.target.value as WatcherType }))
              }
              className="w-full px-3 py-2 rounded-lg border border-border-muted bg-background text-sm outline-none focus:border-accent"
            >
              <option value="folder">{t('watch.type.folder')}</option>
              <option value="rss">{t('watch.type.rss')}</option>
              <option value="url">{t('watch.type.url')}</option>
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-text-secondary">{t('watch.fieldTarget')}</span>
            <input
              type="text"
              value={form.target}
              onChange={(event) => setForm((prev) => ({ ...prev, target: event.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-border-muted bg-background text-sm outline-none focus:border-accent"
              placeholder={t(`watch.targetPlaceholder.${form.type}`)}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-text-secondary">{t('watch.fieldLabel')}</span>
            <input
              type="text"
              value={form.label}
              onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-border-muted bg-background text-sm outline-none focus:border-accent"
              placeholder={t('watch.labelPlaceholder')}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-text-secondary">{t('watch.fieldMode')}</span>
            <select
              value={form.mode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, mode: event.target.value as WatchFormMode }))
              }
              className="w-full px-3 py-2 rounded-lg border border-border-muted bg-background text-sm outline-none focus:border-accent"
            >
              <option value="daily">{t('watch.modeDaily')}</option>
              <option value="weekly">{t('watch.modeWeekly')}</option>
              <option value="interval">{t('watch.modeInterval')}</option>
            </select>
          </label>

          {(form.mode === 'daily' || form.mode === 'weekly') && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-text-secondary">{t('watch.fieldTimes')}</span>
              <input
                type="text"
                value={form.times}
                onChange={(event) => setForm((prev) => ({ ...prev, times: event.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-border-muted bg-background text-sm outline-none focus:border-accent"
                placeholder="08:00, 18:00"
              />
            </label>
          )}

          {form.mode === 'weekly' && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-text-secondary">
                {t('watch.fieldWeekdays')}
              </span>
              <input
                type="text"
                value={form.weekdays}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, weekdays: event.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg border border-border-muted bg-background text-sm outline-none focus:border-accent"
                placeholder="1,2,3,4,5"
              />
              <span className="text-[11px] text-text-muted">{t('watch.weekdaysHint')}</span>
            </label>
          )}

          {form.mode === 'interval' && (
            <div className="flex gap-3">
              <label className="block space-y-1 flex-1">
                <span className="text-xs font-medium text-text-secondary">
                  {t('watch.fieldEvery')}
                </span>
                <input
                  type="number"
                  min={1}
                  value={form.repeatEvery}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      repeatEvery: Number(event.target.value) || 1,
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg border border-border-muted bg-background text-sm outline-none focus:border-accent"
                />
              </label>
              <label className="block space-y-1 flex-1">
                <span className="text-xs font-medium text-text-secondary">
                  {t('watch.fieldUnit')}
                </span>
                <select
                  value={form.repeatUnit}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      repeatUnit: event.target.value as WatcherRepeatUnit,
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg border border-border-muted bg-background text-sm outline-none focus:border-accent"
                >
                  <option value="hour">{t('watch.unit.hour')}</option>
                  <option value="day">{t('watch.unit.day')}</option>
                </select>
              </label>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, enabled: event.target.checked }))
              }
            />
            {t('watch.enabled')}
          </label>

          <button
            type="button"
            onClick={() => void submitForm()}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {editingId ? t('watch.saveChanges') : t('watch.createWatcher')}
          </button>
        </div>
      </SettingsContentSection>

      <SettingsContentSection title={t('watch.listTitle')} description={t('watch.listDesc')}>
        {watchers.length === 0 ? (
          <p className="text-sm text-text-muted">{t('watch.empty')}</p>
        ) : (
          <ul className="space-y-3">
            {watchers.map((watcher) => (
              <li
                key={watcher.id}
                className="rounded-xl border border-border-muted p-4 bg-surface/30 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {watcher.label || watcher.target}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {t(`watch.type.${watcher.type}`)} · {watcher.target}
                    </p>
                    <p className="text-xs text-text-secondary mt-1">
                      {describeWatcherSchedule(watcher, t)}
                    </p>
                    <p className="text-xs text-text-muted mt-1">
                      {watcher.lastRunAt
                        ? t('watch.lastRun', {
                            time: formatAppDateTime(watcher.lastRunAt),
                          })
                        : t('watch.neverRun')}
                    </p>
                    {watcher.lastError && (
                      <p className="text-xs text-error mt-1">{watcher.lastError}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => void toggleWatcher(watcher)}
                      className={`px-2.5 py-1 rounded-md text-xs ${
                        watcher.enabled
                          ? 'bg-accent/15 text-accent'
                          : 'bg-surface-hover text-text-muted'
                      }`}
                    >
                      {watcher.enabled ? t('watch.statusEnabled') : t('watch.statusDisabled')}
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(watcher)}
                      className="p-1.5 rounded-md hover:bg-surface-hover text-text-secondary"
                      title={t('watch.editTitle')}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteWatcher(watcher)}
                      className="p-1.5 rounded-md hover:bg-surface-hover text-error"
                      title={t('watch.delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsContentSection>
    </div>
  );
}
