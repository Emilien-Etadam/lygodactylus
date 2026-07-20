import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces, X } from 'lucide-react';
import type { PromptPreset } from '../../shared/prompt-presets';

interface PresetVariableDialogProps {
  preset: PromptPreset;
  onConfirm: (values: Record<string, string>) => void;
  onClose: () => void;
}

export function PresetVariableDialog({ preset, onConfirm, onClose }: PresetVariableDialogProps) {
  const { t } = useTranslation();
  const variables = preset.variables;

  const initialValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const name of variables) {
      values[name] = '';
    }
    return values;
  }, [variables]);

  const [values, setValues] = useState<Record<string, string>>(initialValues);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div
        role="dialog"
        aria-label={t('presets.variablesTitle')}
        className="card w-full max-w-md p-5 m-4 shadow-elevated animate-slide-up"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center flex-shrink-0">
              <Braces className="w-5 h-5 text-accent" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-text-primary">
                {t('presets.variablesTitle')}
              </h2>
              <p className="text-sm text-text-secondary mt-0.5">
                {t('presets.variablesDesc', { name: preset.name })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4 text-text-secondary" />
          </button>
        </div>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(values);
          }}
        >
          {variables.map((name, index) => (
            <label key={name} className="block space-y-1.5">
              <span className="text-sm font-medium text-text-primary font-mono">{`{{${name}}}`}</span>
              <input
                type="text"
                value={values[name] ?? ''}
                onChange={(event) =>
                  setValues((prev) => ({
                    ...prev,
                    [name]: event.target.value,
                  }))
                }
                autoFocus={index === 0}
                className="w-full px-3 py-2 rounded-lg border border-border-muted bg-background text-sm text-text-primary outline-none focus:border-accent"
                placeholder={t('presets.variablePlaceholder', { name })}
              />
            </label>
          ))}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-hover transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="px-3 py-2 rounded-lg text-sm bg-accent text-white hover:opacity-90 transition-opacity"
            >
              {t('presets.insert')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
