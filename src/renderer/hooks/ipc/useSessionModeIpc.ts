import { useCallback } from 'react';
import type { ClientEvent, Session, SessionMode } from '../../types';
import { isElectron } from './constants';

export interface SessionModeIpcDeps {
  invoke: <T>(event: ClientEvent) => Promise<T>;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
}

export function useSessionModeIpc({ invoke, updateSession }: SessionModeIpcDeps) {
  const setSessionMode = useCallback(
    async (sessionId: string, mode: SessionMode) => {
      updateSession(sessionId, { mode });
      if (!isElectron) {
        return;
      }
      await invoke({
        type: 'session.setMode',
        payload: { sessionId, mode },
      });
    },
    [invoke, updateSession]
  );

  const getSessionMode = useCallback(
    async (sessionId: string): Promise<SessionMode> => {
      if (!isElectron) {
        return 'act';
      }
      const result = await invoke<{ mode: SessionMode }>({
        type: 'session.getMode',
        payload: { sessionId },
      });
      return result?.mode === 'plan' ? 'plan' : 'act';
    },
    [invoke]
  );

  return { setSessionMode, getSessionMode };
}
