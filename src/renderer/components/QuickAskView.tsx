import { FormEvent, Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Check, ClipboardCopy, Loader2, Send } from 'lucide-react';
import { useIPC } from '../hooks/useIPC';
import { useAppStore } from '../store';
import {
  QUICK_ASK_SELECTION_ACTIONS,
  QUICK_ASK_SESSION_TITLE,
  applyQuickAskActionTemplate,
  resolveQuickAskSessionAction,
  type QuickAskOpenMode,
  type QuickAskSelectionAction,
} from '../../shared/quick-ask';

const MessageMarkdown = lazy(() =>
  import('./MessageMarkdown').then((module) => ({ default: module.MessageMarkdown }))
);

function extractAssistantText(
  content: Array<{ type: string; text?: string }> | undefined
): string {
  if (!content) {
    return '';
  }
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text || '')
    .join('\n\n');
}

export function QuickAskView() {
  const { t, i18n } = useTranslation();
  const { startSession, continueSession, listSessions, setSessionMode, isElectron } = useIPC();
  const sessions = useAppStore((s) => s.sessions);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const setShowSettings = useAppStore((s) => s.setShowSettings);

  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<QuickAskOpenMode>('ask');
  const [sourceText, setSourceText] = useState('');
  const [clipboardEmpty, setClipboardEmpty] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isElectron) {
      listSessions();
    }
  }, [isElectron, listSessions]);

  // Reset / hydrate the prompt field each time the window is (re)opened.
  useEffect(() => {
    if (!window.electronAPI?.on) {
      return;
    }
    return window.electronAPI.on((event) => {
      if (event.type !== 'quickAsk.opened') {
        return;
      }
      const payload = event.payload;
      const nextMode = payload?.mode === 'selection' ? 'selection' : 'ask';
      setMode(nextMode);
      setTurnStartedAt(null);
      setIsSubmitting(false);
      setCopied(false);
      if (nextMode === 'selection') {
        setSourceText(payload.sourceText);
        setPrompt(payload.sourceText);
        setClipboardEmpty(payload.empty === true);
        setTruncated(payload.truncated === true);
      } else {
        setSourceText('');
        setPrompt('');
        setClipboardEmpty(false);
        setTruncated(false);
      }
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        window.electronAPI?.window?.hideQuickAsk?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Keep local sessionId in sync if the dedicated session already exists.
  useEffect(() => {
    const existing = resolveQuickAskSessionAction(sessions);
    if (existing.action === 'reuse') {
      setSessionId(existing.sessionId);
    }
  }, [sessions]);

  const assistantReply = useMemo(() => {
    const partialText = sessionId ? (sessionStates[sessionId]?.partialMessage ?? '') : '';
    if (partialText) {
      return { text: partialText, streaming: true };
    }
    if (!turnStartedAt || !sessionId) {
      return { text: '', streaming: false };
    }
    const sessionMessages = sessionStates[sessionId]?.messages ?? [];
    const assistantAfterTurn = [...sessionMessages]
      .reverse()
      .find(
        (message) =>
          message.role === 'assistant' && message.timestamp >= turnStartedAt - 1000
      );
    return {
      text: extractAssistantText(assistantAfterTurn?.content),
      streaming: false,
    };
  }, [sessionId, sessionStates, turnStartedAt]);

  const sessionStatus = sessionId
    ? sessions.find((session) => session.id === sessionId)?.status
    : undefined;
  const isRunning = sessionStatus === 'running' || isSubmitting;

  const applyActionChip = useCallback(
    (action: QuickAskSelectionAction) => {
      if (!sourceText) {
        return;
      }
      const template = t(`quickAsk.templates.${action}`);
      const next = applyQuickAskActionTemplate(template, {
        text: sourceText,
        language: t('quickAsk.uiLanguageName'),
      });
      setPrompt(next);
    },
    [i18n.language, sourceText, t]
  );

  const handleSubmit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const trimmed = prompt.trim();
      if (!trimmed || isRunning) {
        return;
      }

      setIsSubmitting(true);
      setTurnStartedAt(Date.now());
      setShowSettings(false);
      setCopied(false);

      try {
        const action = resolveQuickAskSessionAction(sessions);
        if (action.action === 'reuse') {
          setSessionId(action.sessionId);
          // Keep the dedicated session in plan mode (read-only tool gate).
          const existing = sessions.find((session) => session.id === action.sessionId);
          if (existing && existing.mode !== 'plan' && existing.status !== 'running') {
            await setSessionMode(action.sessionId, 'plan');
          }
          await continueSession(action.sessionId, trimmed);
        } else {
          // Create already in plan mode so the first turn is read-only (no race).
          const session = await startSession(
            QUICK_ASK_SESSION_TITLE,
            trimmed,
            undefined,
            'plan'
          );
          if (session?.id) {
            setSessionId(session.id);
          }
        }
        setPrompt('');
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      continueSession,
      isRunning,
      prompt,
      sessions,
      setSessionMode,
      setShowSettings,
      startSession,
    ]
  );

  const handleOpenInApp = useCallback(() => {
    if (!sessionId) {
      return;
    }
    window.electronAPI?.window?.openSessionInMain?.(sessionId);
  }, [sessionId]);

  const handleCopyResult = useCallback(async () => {
    const text = assistantReply.text.trim();
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [assistantReply.text]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const title =
    mode === 'selection' ? t('quickAsk.selectionTitle') : t('quickAsk.title');
  const subtitle =
    mode === 'selection' ? t('quickAsk.selectionSubtitle') : t('quickAsk.subtitle');
  const emptyHint =
    mode === 'selection' && clipboardEmpty
      ? t('quickAsk.selectionEmptyHint')
      : t('quickAsk.emptyHint');
  const showCopyButton = Boolean(assistantReply.text) && !assistantReply.streaming;

  return (
    <div className="h-full w-full min-h-0 flex flex-col bg-background text-text-primary overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-subtle shrink-0 titlebar-drag">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold truncate">{title}</h1>
          <p className="text-xs text-text-muted truncate">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={handleOpenInApp}
          disabled={!sessionId}
          className="titlebar-no-drag inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-surface hover:bg-surface-hover text-xs font-medium disabled:opacity-40"
        >
          <ArrowUpRight className="w-3.5 h-3.5" />
          {t('quickAsk.openInApp')}
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 titlebar-no-drag">
        {!assistantReply.text && !isRunning ? (
          <p className="text-sm text-text-muted">{emptyHint}</p>
        ) : (
          <Suspense fallback={<p className="text-sm text-text-muted">…</p>}>
            {isRunning && !assistantReply.text ? (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('quickAsk.thinking')}
              </div>
            ) : (
              <div className="space-y-3">
                <MessageMarkdown
                  normalizedText={assistantReply.text}
                  isStreaming={assistantReply.streaming}
                />
                {showCopyButton && (
                  <button
                    type="button"
                    onClick={() => void handleCopyResult()}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90"
                  >
                    {copied ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <ClipboardCopy className="w-4 h-4" />
                    )}
                    {copied ? t('quickAsk.copied') : t('quickAsk.copyResult')}
                  </button>
                )}
              </div>
            )}
          </Suspense>
        )}
      </div>

      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="shrink-0 border-t border-border-subtle px-3 py-3 space-y-2 titlebar-no-drag"
      >
        {mode === 'selection' && (
          <div className="space-y-1.5">
            {truncated && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t('quickAsk.selectionTruncated')}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {QUICK_ASK_SELECTION_ACTIONS.map((action) => (
                <button
                  key={action}
                  type="button"
                  disabled={clipboardEmpty || !sourceText || isRunning}
                  onClick={() => applyActionChip(action)}
                  className="px-2.5 py-1 rounded-md border border-border bg-surface hover:bg-surface-hover text-xs font-medium disabled:opacity-40"
                >
                  {t(`quickAsk.actions.${action}`)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            rows={2}
            placeholder={
              mode === 'selection' && clipboardEmpty
                ? t('quickAsk.selectionPlaceholder')
                : t('quickAsk.placeholder')
            }
            className="flex-1 min-h-[2.75rem] max-h-28 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            autoFocus
          />
          <button
            type="submit"
            disabled={!prompt.trim() || isRunning}
            className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-accent text-white disabled:opacity-40"
            aria-label={t('quickAsk.send')}
          >
            {isRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
