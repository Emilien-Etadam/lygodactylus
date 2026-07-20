import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Undo2 } from 'lucide-react';

interface CheckpointSummary {
  sessionId: string;
  runId: string;
  partialCoverage: boolean;
  restoredAt?: number;
  messageIds: string[];
  files: Array<{ path: string; action: 'modified' | 'created' }>;
}

interface UndoRunButtonProps {
  sessionId: string;
  messageId: string;
  /** Hide while the assistant turn is still streaming. */
  disabled?: boolean;
}

function basename(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

export function UndoRunButton({ sessionId, messageId, disabled }: UndoRunButtonProps) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<CheckpointSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (disabled) {
      setSummary(null);
      return;
    }
    const api = window.electronAPI?.checkpoints?.getForMessage;
    if (!api) {
      return;
    }
    try {
      const result = await api(sessionId, messageId);
      if (
        result &&
        result.files.length > 0 &&
        !result.restoredAt &&
        result.endedAt != null &&
        result.messageIds[result.messageIds.length - 1] === messageId
      ) {
        setSummary(result);
      } else {
        setSummary(null);
      }
    } catch {
      setSummary(null);
    }
  }, [disabled, messageId, sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!window.electronAPI?.on) {
      return;
    }
    return window.electronAPI.on((event) => {
      if (event.type !== 'checkpoint.runReady') {
        return;
      }
      if (event.payload.sessionId !== sessionId) {
        return;
      }
      if (!event.payload.messageIds.includes(messageId)) {
        return;
      }
      void refresh();
    });
  }, [messageId, refresh, sessionId]);

  const handleUndo = useCallback(async () => {
    if (!summary || busy || !window.electronAPI?.checkpoints?.restore) {
      return;
    }
    if (summary.files.length === 0) {
      window.alert(t('messageCard.undoRunNone'));
      return;
    }

    const fileList = summary.files
      .slice(0, 30)
      .map((file) => `• ${basename(file.path)} (${file.action})`)
      .join('\n');
    const more =
      summary.files.length > 30 ? `\n… (+${summary.files.length - 30})` : '';
    const partialNote = summary.partialCoverage
      ? `\n\n${t('messageCard.undoRunPartial')}`
      : '';
    const confirmed = window.confirm(
      t('messageCard.undoRunConfirm', { files: fileList + more }) + partialNote
    );
    if (!confirmed) {
      return;
    }

    setBusy(true);
    try {
      const result = await window.electronAPI.checkpoints.restore(
        summary.sessionId,
        summary.runId
      );
      if (!result.ok) {
        window.alert(
          t('messageCard.undoRunFailed', {
            error: result.error || t('common.error'),
          })
        );
        return;
      }
      window.alert(
        t('messageCard.undoRunSuccess', {
          restored: result.restored.length,
          deleted: result.deleted.length,
        })
      );
      setSummary(null);
    } catch (error) {
      window.alert(
        t('messageCard.undoRunFailed', {
          error: error instanceof Error ? error.message : t('common.error'),
        })
      );
    } finally {
      setBusy(false);
    }
  }, [busy, summary, t]);

  if (!summary) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => void handleUndo()}
      disabled={busy}
      className="w-6 h-6 flex items-center justify-center rounded-md bg-surface-muted hover:bg-surface-active transition-colors disabled:opacity-50"
      title={t('messageCard.undoRun')}
      aria-label={t('messageCard.undoRun')}
    >
      <Undo2 className="w-3 h-3 text-text-muted" />
    </button>
  );
}
