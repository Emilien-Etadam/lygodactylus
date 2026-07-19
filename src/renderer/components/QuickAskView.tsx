import { FormEvent, Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Loader2, Send } from 'lucide-react';
import { useIPC } from '../hooks/useIPC';
import { useAppStore } from '../store';
import {
  QUICK_ASK_SESSION_TITLE,
  resolveQuickAskSessionAction,
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
  const { t } = useTranslation();
  const { startSession, continueSession, listSessions, setSessionMode, isElectron } = useIPC();
  const sessions = useAppStore((s) => s.sessions);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const setShowSettings = useAppStore((s) => s.setShowSettings);

  const [prompt, setPrompt] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isElectron) {
      listSessions();
    }
  }, [isElectron, listSessions]);

  // Reset the prompt field each time the window is (re)opened.
  useEffect(() => {
    if (!window.electronAPI?.on) {
      return;
    }
    return window.electronAPI.on((event) => {
      if (event.type === 'quickAsk.opened') {
        setPrompt('');
        setTurnStartedAt(null);
        setIsSubmitting(false);
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

  return (
    <div className="h-full w-full min-h-0 flex flex-col bg-background text-text-primary overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-subtle shrink-0 titlebar-drag">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold truncate">{t('quickAsk.title')}</h1>
          <p className="text-xs text-text-muted truncate">{t('quickAsk.subtitle')}</p>
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
          <p className="text-sm text-text-muted">{t('quickAsk.emptyHint')}</p>
        ) : (
          <Suspense fallback={<p className="text-sm text-text-muted">…</p>}>
            {isRunning && !assistantReply.text ? (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('quickAsk.thinking')}
              </div>
            ) : (
              <MessageMarkdown
                normalizedText={assistantReply.text}
                isStreaming={assistantReply.streaming}
              />
            )}
          </Suspense>
        )}
      </div>

      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="shrink-0 border-t border-border-subtle px-3 py-3 flex items-end gap-2 titlebar-no-drag"
      >
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
          placeholder={t('quickAsk.placeholder')}
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
      </form>
    </div>
  );
}
