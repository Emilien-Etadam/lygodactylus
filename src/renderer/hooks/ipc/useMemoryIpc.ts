import { useCallback } from 'react';
import type { ClientEvent, Session } from '../../types';
import { isElectron } from './constants';

export interface MemoryIpcDeps {
  invoke: <T>(event: ClientEvent) => Promise<T>;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
}

export function useMemoryIpc({ invoke, updateSession }: MemoryIpcDeps) {
  const setSessionMemoryEnabled = useCallback(
    async (sessionId: string, memoryEnabled: boolean) => {
      updateSession(sessionId, { memoryEnabled });
      if (!isElectron) {
        return;
      }
      await invoke({
        type: 'session.setMemoryEnabled',
        payload: { sessionId, memoryEnabled },
      });
    },
    [invoke, isElectron, updateSession]
  );

  return { setSessionMemoryEnabled };
}
