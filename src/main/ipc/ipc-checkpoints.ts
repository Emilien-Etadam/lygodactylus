/**
 * IPC for run checkpoints (list / restore).
 */
import { ipcMain } from 'electron';
import { checkpointService } from '../checkpoints';
import { mt } from '../i18n';
import { log, logWarn } from '../utils/logger';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function registerCheckpointsIpc(): void {
  ipcMain.handle('checkpoints.getForMessage', (_event, sessionId: unknown, messageId: unknown) => {
    if (!isNonEmptyString(sessionId) || !isNonEmptyString(messageId)) {
      return null;
    }
    return checkpointService.getSummaryForMessage(sessionId.trim(), messageId.trim());
  });

  ipcMain.handle('checkpoints.listForSession', (_event, sessionId: unknown) => {
    if (!isNonEmptyString(sessionId)) {
      return [];
    }
    return checkpointService.listForSession(sessionId.trim());
  });

  ipcMain.handle('checkpoints.restore', (_event, sessionId: unknown, runId: unknown) => {
    if (!isNonEmptyString(sessionId) || !isNonEmptyString(runId)) {
      return {
        ok: false,
        error: mt('checkpointRestoreInvalidArgs'),
        restored: [],
        deleted: [],
        partialCoverage: false,
      };
    }

    const result = checkpointService.restore(sessionId.trim(), runId.trim());
    if (!result.ok) {
      if (result.error === 'run_in_progress') {
        log('[Checkpoints] Restore refused — session run in progress');
        return {
          ...result,
          error: mt('checkpointRestoreRunInProgress'),
        };
      }
      logWarn('[Checkpoints] Restore failed:', result.error);
      return {
        ...result,
        error:
          result.error === 'not_found'
            ? mt('checkpointRestoreNotFound')
            : mt('checkpointRestoreFailed'),
      };
    }

    log(
      `[Checkpoints] Restored run ${runId}: ${result.restored.length} rewritten, ${result.deleted.length} deleted`
    );
    return result;
  });
}
