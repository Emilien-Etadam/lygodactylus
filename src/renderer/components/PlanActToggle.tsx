import { useTranslation } from 'react-i18next';
import { ListTodo, Zap } from 'lucide-react';
import type { SessionMode } from '../types';

interface PlanActToggleProps {
  mode: SessionMode;
  disabled?: boolean;
  onChange: (mode: SessionMode) => void;
}

/**
 * Composer chip that switches the session between Plan (read-only) and Act.
 * Disabled while a run is in progress.
 */
export function PlanActToggle({ mode, disabled = false, onChange }: PlanActToggleProps) {
  const { t } = useTranslation();
  const isPlan = mode === 'plan';

  return (
    <div
      className={`inline-flex items-center rounded-full border border-border-subtle bg-background/60 p-0.5 ${
        disabled ? 'opacity-50' : ''
      }`}
      role="group"
      aria-label={t('chat.planActToggle')}
      title={t('chat.planActToggle')}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('plan')}
        aria-pressed={isPlan}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors disabled:cursor-not-allowed ${
          isPlan
            ? 'bg-accent/15 text-accent'
            : 'text-text-muted hover:text-text-primary'
        }`}
      >
        <ListTodo className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{t('chat.planMode')}</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('act')}
        aria-pressed={!isPlan}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors disabled:cursor-not-allowed ${
          !isPlan
            ? 'bg-accent/15 text-accent'
            : 'text-text-muted hover:text-text-primary'
        }`}
      >
        <Zap className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{t('chat.actMode')}</span>
      </button>
    </div>
  );
}
