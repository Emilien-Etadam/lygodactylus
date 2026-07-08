import { useCallback } from 'react';
import type { ClientEvent } from '../../types';
import { isElectron } from './constants';

export function useIpcCore() {
  // Send event to main process
  const send = useCallback((event: ClientEvent) => {
    if (!isElectron) {
      console.log('[useIPC] Browser mode - would send:', event.type);
      return;
    }
    console.log('[useIPC] Sending:', event.type);
    window.electronAPI.send(event);
  }, []);

  // Invoke and wait for response
  const invoke = useCallback(async <T>(event: ClientEvent): Promise<T> => {
    if (!isElectron) {
      console.log('[useIPC] Browser mode - would invoke:', event.type);
      return null as T;
    }
    console.log('[useIPC] Invoking:', event.type);
    return window.electronAPI.invoke<T>(event);
  }, []);

  return { send, invoke };
}
