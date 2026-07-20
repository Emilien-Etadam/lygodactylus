import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type {
  PromptPreset,
  PromptPresetCreateInput,
  PromptPresetUpdateInput,
} from '../../../shared/prompt-presets';
import { detectTemplateVariables } from '../../../shared/prompt-presets';
import { SettingsContentSection, renderLocalizedBannerMessage } from './shared';
import type { LocalizedBanner } from './shared';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

function emptyForm(): {
  name: string;
  description: string;
  text: string;
  systemPrompt: string;
} {
  return {
    name: '',
    description: '',
    text: '',
    systemPrompt: '',
  };
}

export function SettingsPresets({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<LocalizedBanner | null>(null);
  const [success, setSuccess] = useState<LocalizedBanner | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const detectedVariables = useMemo(
    () => detectTemplateVariables(form.text, form.systemPrompt),
    [form.text, form.systemPrompt]
  );

  const loadPresets = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.presets?.list) return;
    setIsLoading(true);
    setError(null);
    try {
      const rows = await window.electronAPI.presets.list();
      setPresets(rows);
    } catch (err) {
      setError(err instanceof Error ? { text: err.message } : { key: 'presets.loadFailed' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isElectron || !isActive) return;
    void loadPresets();
  }, [isActive, loadPresets]);

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm());
  }

  function startEdit(preset: PromptPreset) {
    setEditingId(preset.id);
    setForm({
      name: preset.name,
      description: preset.description,
      text: preset.text,
      systemPrompt: preset.systemPrompt,
    });
    setError(null);
    setSuccess(null);
  }

  async function submitForm() {
    if (!isElectron || !window.electronAPI?.presets) return;
    const name = form.name.trim();
    if (!name) {
      setError({ key: 'presets.nameRequired' });
      return;
    }
    if (!form.text.trim()) {
      setError({ key: 'presets.textRequired' });
      return;
    }

    setError(null);
    setSuccess(null);
    try {
      if (editingId) {
        const updates: PromptPresetUpdateInput = {
          name,
          description: form.description,
          text: form.text,
          systemPrompt: form.systemPrompt,
        };
        const updated = await window.electronAPI.presets.update(editingId, updates);
        if (!updated) {
          setError({ key: 'presets.saveFailed' });
          return;
        }
        setSuccess({ key: 'presets.updated' });
      } else {
        const payload: PromptPresetCreateInput = {
          name,
          description: form.description,
          text: form.text,
          systemPrompt: form.systemPrompt,
        };
        await window.electronAPI.presets.create(payload);
        setSuccess({ key: 'presets.created' });
      }
      resetForm();
      await loadPresets();
    } catch (err) {
      setError(err instanceof Error ? { text: err.message } : { key: 'presets.saveFailed' });
    }
  }

  async function deletePreset(preset: PromptPreset) {
    if (!isElectron || !window.electronAPI?.presets?.delete) return;
    if (!window.confirm(t('presets.deleteConfirm', { name: preset.name }))) return;
    setError(null);
    setSuccess(null);
    try {
      const result = await window.electronAPI.presets.delete(preset.id);
      if (!result.success) {
        setError({ key: 'presets.deleteFailed' });
        return;
      }
      if (editingId === preset.id) {
        resetForm();
      }
      setSuccess({ key: 'presets.deleted' });
      await loadPresets();
    } catch (err) {
      setError(err instanceof Error ? { text: err.message } : { key: 'presets.deleteFailed' });
    }
  }

  return (
    <div className="space-y-6">
      <SettingsContentSection
        title={t('presets.manageTitle')}
        description={t('presets.manageDesc')}
      >
        {error && (
          <p className="text-sm text-error">{renderLocalizedBannerMessage(error, t)}</p>
        )}
        {success && (
          <p className="text-sm text-success">{renderLocalizedBannerMessage(success, t)}</p>
        )}

        <div className="space-y-3 rounded-xl border border-border-muted p-4 bg-surface/40">
          <div className="flex items-center justify-between gap-2">
            <h5 className="text-sm font-medium text-text-primary">
              {editingId ? t('presets.editTitle') : t('presets.createTitle')}
            </h5>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs text-text-muted hover:text-text-primary"
              >
                {t('presets.cancelEdit')}
              </button>
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-text-secondary">{t('presets.fieldName')}</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-border-muted bg-background text-sm outline-none focus:border-accent"
              placeholder={t('presets.fieldNamePlaceholder')}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-text-secondary">
              {t('presets.fieldDescription')}
            </span>
            <input
              type="text"
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
              className="w-full px-3 py-2 rounded-lg border border-border-muted bg-background text-sm outline-none focus:border-accent"
              placeholder={t('presets.fieldDescriptionPlaceholder')}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-text-secondary">{t('presets.fieldText')}</span>
            <textarea
              value={form.text}
              onChange={(event) => setForm((prev) => ({ ...prev, text: event.target.value }))}
              rows={5}
              className="w-full px-3 py-2 rounded-lg border border-border-muted bg-background text-sm outline-none focus:border-accent font-mono"
              placeholder={t('presets.fieldTextPlaceholder')}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-text-secondary">
              {t('presets.fieldSystemPrompt')}
            </span>
            <textarea
              value={form.systemPrompt}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, systemPrompt: event.target.value }))
              }
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-border-muted bg-background text-sm outline-none focus:border-accent font-mono"
              placeholder={t('presets.fieldSystemPromptPlaceholder')}
            />
            <span className="block text-[11px] text-text-muted">
              {t('presets.systemPromptHint')}
            </span>
          </label>

          <div className="text-[11px] text-text-muted font-mono">
            {detectedVariables.length > 0
              ? t('presets.detectedVariables', {
                  variables: detectedVariables.map((name) => `{{${name}}}`).join(', '),
                })
              : t('presets.noVariables')}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void submitForm()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-accent text-white hover:opacity-90"
            >
              <Plus className="w-4 h-4" />
              {editingId ? t('presets.save') : t('presets.create')}
            </button>
          </div>
        </div>
      </SettingsContentSection>

      <SettingsContentSection title={t('presets.listTitle')} description={t('presets.listDesc')}>
        {isLoading ? (
          <p className="text-sm text-text-muted">{t('common.loading')}</p>
        ) : presets.length === 0 ? (
          <p className="text-sm text-text-muted">{t('presets.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {presets.map((preset) => (
              <li
                key={preset.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-border-muted px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{preset.name}</p>
                  {preset.description ? (
                    <p className="text-xs text-text-muted mt-0.5 line-clamp-2">
                      {preset.description}
                    </p>
                  ) : null}
                  {preset.variables.length > 0 ? (
                    <p className="text-[11px] text-text-muted mt-1 font-mono">
                      {preset.variables.map((variable) => `{{${variable}}}`).join(' · ')}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(preset)}
                    className="p-2 rounded-lg hover:bg-surface-hover text-text-secondary"
                    title={t('common.edit')}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deletePreset(preset)}
                    className="p-2 rounded-lg hover:bg-surface-hover text-error"
                    title={t('common.delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsContentSection>
    </div>
  );
}
