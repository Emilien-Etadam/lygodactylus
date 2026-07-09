/**
 * @module main/chat-lan-server/chat-lan-rpc
 *
 * Allowlisted RPC channels exposed to the LAN web UI (`/api/rpc`). This is the
 * remote counterpart of the preload's namespaced `ipcRenderer.invoke` surface,
 * restricted to what the chat page needs. Settings/management channels
 * (config.save, mcp.saveServer, marketplace.*, ...) are deliberately absent:
 * a LAN token must not grant remote reconfiguration of the desktop app.
 */
import { app } from 'electron';
import { isAbsolute } from 'path';
import { configStore } from '../config/config-store';
import { mainAppState } from '../main-app-state';
import { listRecentWorkspaceFiles } from '../utils/recent-workspace-files';
import { redactSecrets } from './chat-lan-redact';

type RpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;

const RPC_HANDLERS: Record<string, RpcHandler> = {
  'get-version': () => app.getVersion(),

  'config.get': () => redactSecrets(configStore.getAll()),

  'config.isConfigured': () => configStore.isConfigured(),

  'plugins.listCommands': () => {
    if (!mainAppState.pluginRuntimeService) {
      return [];
    }
    return mainAppState.pluginRuntimeService.listAvailableCommands();
  },

  'mcp.getServerStatus': () => {
    if (!mainAppState.sessionManager) {
      return [];
    }
    return mainAppState.sessionManager.getMCPManager().getServerStatus();
  },

  'artifacts.listRecentFiles': (cwd, sinceMs, limit) => {
    if (typeof cwd !== 'string' || !cwd || !isAbsolute(cwd)) {
      return [];
    }
    const since = typeof sinceMs === 'number' ? sinceMs : 0;
    const max = Math.min(typeof limit === 'number' ? limit : 50, 500);
    return listRecentWorkspaceFiles(cwd, since, max);
  },
};

export function isAllowedRpcChannel(channel: unknown): channel is string {
  return typeof channel === 'string' && Object.prototype.hasOwnProperty.call(RPC_HANDLERS, channel);
}

export async function handleChatLanRpc(channel: string, args: unknown[]): Promise<unknown> {
  const handler = RPC_HANDLERS[channel];
  if (!handler) {
    throw new Error(`rpc_channel_not_allowed: ${channel}`);
  }
  return handler(...args);
}
