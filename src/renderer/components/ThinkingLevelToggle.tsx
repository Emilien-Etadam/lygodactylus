import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Check } from 'lucide-react';
import { useAppConfig } from '../store/selectors';
import type { ThinkingLevel } from '../types';

type ThinkingChoice = 'off' | ThinkingLevel;

const THINKING_CHOICES: ThinkingChoice[] = ['off', 'low', 'medium', 'high'];

/**
 * Composer chip that switches the model's reasoning level (off/low/medium/high)
 * between prompts. Persists to the app config, which the agent runner re-reads
 * on every run and hot-swaps onto the cached session.
 */
export function ThinkingLevelToggle() {
  const { t } = useTranslation();
  const appConfig = useAppConfig();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  if (typeof window === 'undefined' || !window.electronAPI?.config?.save) {
    return null;
  }

  const current: ThinkingChoice = appConfig?.enableThinking
    ? (appConfig.thinkingLevel ?? 'medium')
    : 'off';
  const active = current !== 'off';

  const applyLevel = async (choice: ThinkingChoice) => {
    setOpen(false);
    if (choice === current || saving) {
      return;
    }
    setSaving(true);
    try {
      await window.electronAPI.config.save(
        choice === 'off' ? { enableThinking: false } : { enableThinking: true, thinkingLevel: choice }
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={saving}
        title={t('chat.thinkingToggle')}
        aria-label={t('chat.thinkingToggle')}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-colors ${
          active
            ? 'border-accent/40 bg-accent/10 text-accent'
            : 'border-border-subtle bg-background/60 text-text-muted hover:text-text-primary'
        }`}
      >
        <Brain className="w-3.5 h-3.5" />
        <span className="hidden sm:inline font-medium">{t(`chat.thinkingLevels.${current}`)}</span>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-44 rounded-xl border border-border-muted bg-background shadow-soft py-1 z-20">
          {THINKING_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => void applyLevel(choice)}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover ${
                choice === current ? 'text-accent' : 'text-text-primary'
              }`}
            >
              <span>{t(`chat.thinkingLevels.${choice}`)}</span>
              {choice === current && <Check className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
