import { useTranslation } from 'react-i18next';
import { FileText, Folder, Link2 } from 'lucide-react';

export type MentionSuggestion =
  { kind: 'file' | 'directory'; relativePath: string } | { kind: 'url'; url: string };

interface MentionMenuProps {
  suggestions: MentionSuggestion[];
  highlightedIndex: number;
  onSelect: (suggestion: MentionSuggestion) => void;
  onHighlight: (index: number) => void;
}

export function MentionMenu({
  suggestions,
  highlightedIndex,
  onSelect,
  onHighlight,
}: MentionMenuProps) {
  const { t } = useTranslation();

  return (
    <div
      role="listbox"
      aria-label={t('chat.atMentions.menuLabel')}
      className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl border border-border-muted bg-surface shadow-elevated overflow-hidden z-30"
    >
      <div className="px-3 py-2 border-b border-border-muted/80">
        <div className="text-xs font-medium text-text-muted">{t('chat.atMentions.menuLabel')}</div>
        <div className="text-[11px] text-text-muted/80 mt-0.5">
          {t('chat.atMentions.placeholder')}
        </div>
      </div>
      {suggestions.length === 0 ? (
        <div className="px-3 py-3 text-xs text-text-muted">{t('chat.atMentions.empty')}</div>
      ) : (
        <ul className="py-1 max-h-64 overflow-y-auto">
          {suggestions.map((suggestion, index) => {
            const isHighlighted = index === highlightedIndex;
            const key =
              suggestion.kind === 'url' ? `url:${suggestion.url}` : suggestion.relativePath;
            const label = suggestion.kind === 'url' ? suggestion.url : suggestion.relativePath;
            const description =
              suggestion.kind === 'url'
                ? t('chat.atMentions.urlDescription')
                : suggestion.kind === 'directory'
                  ? t('chat.atMentions.directoryDescription')
                  : t('chat.atMentions.fileDescription');
            const Icon =
              suggestion.kind === 'url'
                ? Link2
                : suggestion.kind === 'directory'
                  ? Folder
                  : FileText;

            return (
              <li key={key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isHighlighted}
                  onMouseEnter={() => onHighlight(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(suggestion);
                  }}
                  className={`w-full px-3 py-2.5 flex items-start gap-3 text-left transition-colors ${
                    isHighlighted ? 'bg-accent/10' : 'hover:bg-surface-hover'
                  }`}
                >
                  <Icon className="w-4 h-4 mt-0.5 text-accent flex-shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-text-primary font-mono truncate">
                      @{label}
                    </span>
                    <span className="block text-xs text-text-muted mt-0.5">{description}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
