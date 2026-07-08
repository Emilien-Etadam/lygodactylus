import { useCallback } from 'react';
import type { ClientEvent } from '../../types';
import { isElectron } from './constants';

export interface WorkdirIpcDeps {
  invoke: <T>(event: ClientEvent) => Promise<T>;
}

export function useWorkdirIpc({ invoke }: WorkdirIpcDeps) {
  const selectFolder = useCallback(async (): Promise<string | null> => {
    if (!isElectron) {
      return '/mock/folder/path';
    }
    return invoke<string | null>({ type: 'folder.select', payload: {} });
  }, [invoke]);

  const getWorkingDir = useCallback(async (): Promise<string | null> => {
    if (!isElectron) {
      return '/mock/working/dir';
    }
    return invoke<string | null>({ type: 'workdir.get', payload: {} });
  }, [invoke]);

  const changeWorkingDir = useCallback(
    async (
      sessionId?: string,
      currentPath?: string
    ): Promise<{ success: boolean; path: string; error?: string }> => {
      if (!isElectron) {
        return { success: true, path: '/mock/working/dir' };
      }
      return invoke<{ success: boolean; path: string; error?: string }>({
        type: 'workdir.select',
        payload: { sessionId, currentPath },
      });
    },
    [invoke]
  );

  return { selectFolder, getWorkingDir, changeWorkingDir };
}
