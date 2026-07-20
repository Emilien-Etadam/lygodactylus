import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Expand, RefreshCw, X } from 'lucide-react';
import { useAppStore } from '../store';
import {
  buildPreviewSrcdoc,
  collectPreviewArtifacts,
  resolvePreviewVersionIndex,
  versionsOfKind,
} from '../../shared/html-preview';

/**
 * Side panel: sandboxed iframe preview of HTML/SVG assistant code blocks.
 * iframe uses sandbox="allow-scripts" without allow-same-origin.
 */
export function HtmlPreviewPanel() {
  const { t } = useTranslation();
  const htmlPreview = useAppStore((s) => s.htmlPreview);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const closeHtmlPreview = useAppStore((s) => s.closeHtmlPreview);
  const setHtmlPreviewVersion = useAppStore((s) => s.setHtmlPreviewVersion);
  const [iframeKey, setIframeKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const versions = useMemo(() => {
    if (!htmlPreview) {
      return [];
    }
    const messages = sessionStates[htmlPreview.sessionId]?.messages ?? [];
    return versionsOfKind(collectPreviewArtifacts(messages), htmlPreview.kind);
  }, [htmlPreview, sessionStates]);

  // Keep version index in range when the artifact list changes (e.g. new reply).
  useEffect(() => {
    if (!htmlPreview || versions.length === 0) {
      return;
    }
    if (htmlPreview.versionIndex < versions.length) {
      return;
    }
    const resolved = resolvePreviewVersionIndex(
      versions,
      htmlPreview.kind,
      htmlPreview.focusSource
    );
    setHtmlPreviewVersion(Math.min(resolved, versions.length - 1));
  }, [htmlPreview, versions, setHtmlPreviewVersion]);

  if (!htmlPreview) {
    return null;
  }

  const selected = versions[htmlPreview.versionIndex] ?? versions[versions.length - 1] ?? null;
  const source = selected?.source ?? htmlPreview.focusSource;
  const srcdoc = buildPreviewSrcdoc(source, htmlPreview.kind);
  const titleKey = htmlPreview.kind === 'svg' ? 'htmlPreview.titleSvg' : 'htmlPreview.titleHtml';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable
    }
  };

  const handleOpenLarge = () => {
    const api = window.electronAPI?.window?.openHtmlPreview;
    if (!api) {
      return;
    }
    void api(srcdoc);
  };

  return (
    <div className="w-[28rem] max-w-[40vw] bg-background border-l border-border-muted flex flex-col overflow-hidden text-sm shrink-0">
      <div className="px-3 h-10 flex items-center gap-2 border-b border-border-muted shrink-0">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider flex-1 truncate">
          {t(titleKey)}
        </span>
        {versions.length > 1 && (
          <select
            className="text-xs bg-surface border border-border rounded px-1.5 py-1 text-text-primary max-w-[5.5rem]"
            value={String(Math.min(htmlPreview.versionIndex, Math.max(versions.length - 1, 0)))}
            onChange={(event) => setHtmlPreviewVersion(Number(event.target.value))}
            title={t('htmlPreview.version', { n: htmlPreview.versionIndex + 1 })}
            aria-label={t('htmlPreview.version', { n: htmlPreview.versionIndex + 1 })}
          >
            {versions.map((artifact, index) => (
              <option key={artifact.id} value={String(index)}>
                {t('htmlPreview.version', { n: artifact.version })}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => setIframeKey((key) => key + 1)}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          title={t('htmlPreview.refresh')}
          aria-label={t('htmlPreview.refresh')}
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={handleOpenLarge}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          title={t('htmlPreview.openLarge')}
          aria-label={t('htmlPreview.openLarge')}
        >
          <Expand className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          title={t('htmlPreview.copySource')}
          aria-label={t('htmlPreview.copySource')}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-success" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={closeHtmlPreview}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          title={t('htmlPreview.close')}
          aria-label={t('htmlPreview.close')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 bg-white">
        {/*
          sandbox="allow-scripts" only — no allow-same-origin (total isolation).
          CSP in srcdoc blocks all network. No preload bridge is available here.
        */}
        <iframe
          key={iframeKey}
          title={t(titleKey)}
          sandbox="allow-scripts"
          srcDoc={srcdoc}
          className="w-full h-full border-0"
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
}
