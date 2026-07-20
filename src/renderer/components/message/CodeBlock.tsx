// Fenced code block with syntax highlighting (highlight.js) and copy button
import { useState, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Eye } from 'lucide-react';
import hljs from 'highlight.js';
import { useAppStore } from '../../store';
import type { Message } from '../../types';
import {
  collectPreviewArtifacts,
  isPreviewableCodeBlock,
  normalizePreviewLanguage,
  resolvePreviewVersionIndex,
} from '../../../shared/html-preview';

const EMPTY_MESSAGES: Message[] = [];

// Sanitize highlight.js output - only allow highlight span tags
const sanitizeHighlight = (html: string): string =>
  html.replace(/<(?!\/?span(?:\s+class="hljs-[^"]*")?\s*\/?>)[^>]*>/g, (match) =>
    match.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  );

interface CodeBlockProps {
  language: string;
  children: string;
}

export const CodeBlock = memo(function CodeBlock({ language, children }: CodeBlockProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const messages = useAppStore((s) =>
    activeSessionId
      ? (s.sessionStates[activeSessionId]?.messages ?? EMPTY_MESSAGES)
      : EMPTY_MESSAGES
  );
  const openHtmlPreview = useAppStore((s) => s.openHtmlPreview);

  const previewKind = useMemo(() => {
    if (!isPreviewableCodeBlock(language, children)) {
      return null;
    }
    return normalizePreviewLanguage(language);
  }, [language, children]);

  const highlightedHtml = useMemo(() => {
    try {
      const lang = language.toLowerCase();
      let result: string;
      if (hljs.getLanguage(lang)) {
        result = hljs.highlight(children, { language: lang }).value;
      } else {
        result = hljs.highlightAuto(children).value;
      }
      return sanitizeHighlight(result);
    } catch {
      return null;
    }
  }, [children, language]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write can fail if focus is lost or permission denied
    }
  };

  const handlePreview = () => {
    if (!previewKind || !activeSessionId) {
      return;
    }
    const artifacts = collectPreviewArtifacts(messages);
    const versionIndex = resolvePreviewVersionIndex(artifacts, previewKind, children);
    openHtmlPreview({
      sessionId: activeSessionId,
      kind: previewKind,
      source: children,
      versionIndex,
    });
  };

  return (
    <div className="relative group my-3">
      <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-xs text-text-muted px-2 py-1 rounded bg-surface">{language}</span>
        {previewKind && (
          <button
            type="button"
            onClick={handlePreview}
            className="h-7 px-2 flex items-center gap-1 rounded bg-surface hover:bg-surface-hover transition-colors text-xs text-text-primary"
            title={t('htmlPreview.preview')}
          >
            <Eye className="w-3.5 h-3.5 text-text-muted" />
            <span>{t('htmlPreview.preview')}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="w-7 h-7 flex items-center justify-center rounded bg-surface hover:bg-surface-hover transition-colors"
          title={t('messageCard.copyBlock')}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-success" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-text-muted" />
          )}
        </button>
      </div>
      <pre className="code-block">
        {highlightedHtml ? (
          // highlight.js sanitizes and escapes input before injecting span tokens
          <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        ) : (
          <code>{children}</code>
        )}
      </pre>
    </div>
  );
});
