import { useCallback } from 'react';
import { isElectron } from './constants';

export function useMcpIpc() {
  const getMCPServers = useCallback(async () => {
    if (!isElectron) {
      return [];
    }
    // Use the exposed mcp.getServerStatus method
    return window.electronAPI.mcp.getServerStatus();
  }, []);

  return { getMCPServers };
}
