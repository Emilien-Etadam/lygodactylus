import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Globe } from 'lucide-react';
import type { WebCitationSource } from '../../../shared/web-citation';
import { hostnameFromUrl } from '../../../shared/web-citation';

interface MessageSourcesCardProps {
  sources: WebCitationSource[];
}

export const MessageSourcesCard = memo(function MessageSourcesCard({
  sources,
}: MessageSourcesCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-2xl border border-border-subtle bg-background/40 overflow-hidden mt-2">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-hover/50 transition-colors"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        )}
        <Globe className="w-3.5 h-3.5 text-text-muted flex-shrink-0" aria-hidden />
        <span className="text-xs font-medium text-text-secondary">{t('messageCard.sources')}</span>
        {sources.length > 0 && (
          <span className="text-[11px] text-text-muted tabular-nums">{sources.length}</span>
        )}
      </button>

      {expanded &&
        (sources.length === 0 ? (
          <p className="border-t border-border-subtle px-2.5 py-2 text-xs text-text-muted">
            {t('messageCard.sourcesEmpty')}
          </p>
        ) : (
          <ul className="border-t border-border-subtle px-2.5 py-2 space-y-1.5">
            {sources.map((source) => {
              const domain = hostnameFromUrl(source.url);
              return (
                <li key={source.index}>
                  <a
                    href={source.url}
                    rel="noreferrer"
                    onClick={(event) => {
                      event.preventDefault();
                      if (
                        typeof window !== 'undefined' &&
                        window.electronAPI?.openExternal &&
                        /^(?:https?:)/i.test(source.url)
                      ) {
                        void window.electronAPI.openExternal(source.url);
                      }
                    }}
                    className="flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-hover/60 transition-colors group"
                    title={source.url}
                  >
                    <span className="text-[11px] text-text-muted tabular-nums mt-0.5 flex-shrink-0">
                      [{source.index}]
                    </span>
                    <Globe
                      className="w-3.5 h-3.5 text-text-muted mt-0.5 flex-shrink-0"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-accent group-hover:text-accent-hover truncate">
                        {source.title}
                      </span>
                      <span className="block text-[11px] text-text-muted truncate">{domain}</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
});
