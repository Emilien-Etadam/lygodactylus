import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, ListTodo, ShieldCheck, Zap } from 'lucide-react';
import type { SessionAutonomy, SessionMode } from '../types';

interface PlanActToggleProps {
  mode: SessionMode;
  autonomy: SessionAutonomy;
  disabled?: boolean;
  onChangeMode: (mode: SessionMode) => void;
  onChangeAutonomy: (autonomy: SessionAutonomy) => void;
}

/**
 * Composer chip: Plan | Act, and under Act a careful/normal/autonomous selector.
 * Disabled while a run is in progress. Autonomy hidden in plan mode.
 */
export function PlanActToggle({
  mode,
  autonomy,
  disabled = false,
  onChangeMode,
  onChangeAutonomy,
}: PlanActToggleProps) {
  const { t } = useTranslation();
  const isPlan = mode === 'plan';

  return (
    <div className="inline-flex flex-col items-stretch gap-1">
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
          onClick={() => onChangeMode('plan')}
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
          onClick={() => onChangeMode('act')}
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

      {!isPlan && (
        <div
          className={`inline-flex items-center justify-center rounded-full border border-border-subtle bg-background/60 p-0.5 ${
            disabled ? 'opacity-50' : ''
          }`}
          role="group"
          aria-label={t('chat.autonomyToggle')}
        >
          <AutonomyButton
            active={autonomy === 'careful'}
            disabled={disabled}
            title={t('chat.autonomyCarefulTooltip')}
            label={t('chat.autonomyCareful')}
            onClick={() => onChangeAutonomy('careful')}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
          </AutonomyButton>
          <AutonomyButton
            active={autonomy === 'normal'}
            disabled={disabled}
            title={t('chat.autonomyNormalTooltip')}
            label={t('chat.autonomyNormal')}
            onClick={() => onChangeAutonomy('normal')}
          >
            <Zap className="w-3.5 h-3.5" />
          </AutonomyButton>
          <AutonomyButton
            active={autonomy === 'autonomous'}
            disabled={disabled}
            title={t('chat.autonomyAutonomousTooltip')}
            label={t('chat.autonomyAutonomous')}
            onClick={() => onChangeAutonomy('autonomous')}
          >
            <Bot className="w-3.5 h-3.5" />
          </AutonomyButton>
        </div>
      )}
    </div>
  );
}

function AutonomyButton({
  active,
  disabled,
  title,
  label,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  title: string;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={title}
      className={`inline-flex items-center justify-center p-1 rounded-full transition-colors disabled:cursor-not-allowed ${
        active
          ? 'bg-accent/15 text-accent'
          : 'text-text-muted hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}
