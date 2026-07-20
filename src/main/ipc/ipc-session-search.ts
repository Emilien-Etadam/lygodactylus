/**
 * @module main/ipc/ipc-session-search
 *
 * Desktop-only conversation search. Intentionally NOT wired through
 * client-event-allowlist (LAN access can come later).
 */
import { ipcMain } from 'electron';
import { mainAppState } from '../main-app-state';
import { logError } from '../utils/logger';
import type { SessionMessageSearchHit } from '../db/message-search-index';

export function registerSessionSearchIpc(): void {
  ipcMain.handle(
    'session.searchMessages',
    (
      _event,
      payload: { query?: unknown; limit?: unknown }
    ): SessionMessageSearchHit[] => {
      if (!mainAppState.sessionManager) {
        throw new Error('Session manager not initialized');
      }

      const query = typeof payload?.query === 'string' ? payload.query : '';
      const limit =
        typeof payload?.limit === 'number' && Number.isFinite(payload.limit)
          ? payload.limit
          : undefined;

      try {
        return mainAppState.sessionManager.searchMessages(query, limit);
      } catch (error) {
        logError('[SessionSearch] searchMessages failed:', error);
        return [];
      }
    }
  );
}
