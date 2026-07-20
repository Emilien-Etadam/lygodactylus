import { useCallback } from 'react';
import type { ClientEvent, Session, SessionAutonomy } from '../../types';
import { normalizeSessionAutonomy } from '../../../shared/session-autonomy';
import { isElectron } from './constants';

export interface SessionAutonomyIpcDeps {
  invoke: <T>(event: ClientEvent) => Promise<T>;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
}

export function useSessionAutonomyIpc({ invoke, updateSession }: SessionAutonomyIpcDeps) {
  const setSessionAutonomy = useCallback(
    async (sessionId: string, autonomy: SessionAutonomy) => {
      updateSession(sessionId, { autonomy });
      if (!isElectron) {
        return;
      }
      await invoke({
        type: 'session.setAutonomy',
        payload: { sessionId, autonomy },
      });
    },
    [invoke, updateSession]
  );

  const getSessionAutonomy = useCallback(
    async (sessionId: string): Promise<SessionAutonomy> => {
      if (!isElectron) {
        return 'normal';
      }
      const result = await invoke<{ autonomy: SessionAutonomy }>({
        type: 'session.getAutonomy',
        payload: { sessionId },
      });
      return normalizeSessionAutonomy(result?.autonomy);
    },
    [invoke]
  );

  return { setSessionAutonomy, getSessionAutonomy };
}
