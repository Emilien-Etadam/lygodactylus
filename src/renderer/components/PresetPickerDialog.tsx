import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookMarked, X } from 'lucide-react';
import type { PromptPreset } from '../../shared/prompt-presets';

interface PresetPickerDialogProps {
  presets: PromptPreset[];
  onSelect: (preset: PromptPreset) => void;
  onClose: () => void;
}

export function PresetPickerDialog({ presets, onSelect, onClose }: PresetPickerDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);

  const filtered = presets.filter((preset) => {
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return (
      preset.name.toLowerCase().includes(needle) ||
      preset.description.toLowerCase().includes(needle)
    );
  });

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, presets.length]);

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div
        role="dialog"
        aria-label={t('presets.pickerTitle')}
        className="card w-full max-w-lg p-5 m-4 shadow-elevated animate-slide-up"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center flex-shrink-0">
              <BookMarked className="w-5 h-5 text-accent" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-text-primary">{t('presets.pickerTitle')}</h2>
              <p className="text-sm text-text-secondary mt-0.5">{t('presets.pickerDesc')}</p>
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

        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setHighlightIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlightIndex((index) => Math.max(index - 1, 0));
              return;
            }
            if (event.key === 'Enter' && filtered[highlightIndex]) {
              event.preventDefault();
              onSelect(filtered[highlightIndex]);
            }
          }}
          placeholder={t('presets.searchPlaceholder')}
          className="w-full px-3 py-2 rounded-lg border border-border-muted bg-background text-sm text-text-primary outline-none focus:border-accent"
          autoFocus
        />

        <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-border-muted">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-sm text-text-muted text-center">
              {presets.length === 0 ? t('presets.empty') : t('presets.noMatch')}
            </p>
          ) : (
            <ul role="listbox" className="py-1">
              {filtered.map((preset, index) => {
                const isHighlighted = index === highlightIndex;
                return (
                  <li key={preset.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      onMouseEnter={() => setHighlightIndex(index)}
                      onClick={() => onSelect(preset)}
                      className={`w-full px-4 py-3 text-left transition-colors ${
                        isHighlighted ? 'bg-accent/10' : 'hover:bg-surface-hover'
                      }`}
                    >
                      <span className="block text-sm font-medium text-text-primary">
                        {preset.name}
                      </span>
                      {preset.description ? (
                        <span className="block text-xs text-text-muted mt-0.5 line-clamp-2">
                          {preset.description}
                        </span>
                      ) : null}
                      {preset.variables.length > 0 ? (
                        <span className="block text-[11px] text-text-muted mt-1 font-mono">
                          {preset.variables.map((variable) => `{{${variable}}}`).join(' · ')}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
