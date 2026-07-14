/**
 * @module main/ipc/ipc-marketplace
 */
import { ipcMain } from 'electron';
import { logError } from '../utils/logger';
import { mainAppState } from '../main-app-state';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import { notifyPluginCommandsChanged } from './plugin-commands-notify';

async function syncMcpAfterMarketplaceChange(serverId?: string): Promise<void> {
  if (!mainAppState.sessionManager) {
    return;
  }

  mainAppState.sessionManager.invalidateMcpServersCache();

  if (!serverId) {
    return;
  }

  const mcpManager = mainAppState.sessionManager.getMCPManager();
  const config = mcpConfigStore.getServer(serverId);
  if (!config) {
    return;
  }

  try {
    await mcpManager.updateServer(config);
  } catch (error) {
    // Installation must succeed even when Chrome (or another MCP) is not ready yet.
    logError('[Marketplace] MCP server saved; live connection deferred:', error);
  }
}

export function registerMarketplaceIpc(): void {
  ipcMain.handle('marketplace.list', async (_event, forceRefresh = false) => {
    if (!mainAppState.marketplaceService) {
      throw new Error('MarketplaceService not initialized');
    }
    return mainAppState.marketplaceService.list(forceRefresh === true);
  });

  ipcMain.handle('marketplace.getMeta', async (_event, forceRefresh = false) => {
    if (!mainAppState.marketplaceService) {
      throw new Error('MarketplaceService not initialized');
    }
    return mainAppState.marketplaceService.getMeta(forceRefresh === true);
  });

  ipcMain.handle(
    'marketplace.install',
    async (_event, catalogId: string, envValues?: Record<string, string>) => {
      if (!mainAppState.marketplaceService) {
        throw new Error('MarketplaceService not initialized');
      }
      const result = await mainAppState.marketplaceService.install(catalogId, envValues);
      if (result.type === 'mcp' && result.installedRef) {
        await syncMcpAfterMarketplaceChange(result.installedRef);
      }
      if (result.type === 'skill' || result.type === 'plugin') {
        mainAppState.sessionManager?.invalidateSkillsSetup();
      }
      if (result.type === 'plugin') {
        notifyPluginCommandsChanged();
      }
      return result;
    }
  );

  ipcMain.handle('marketplace.uninstall', async (_event, catalogId: string) => {
    if (!mainAppState.marketplaceService) {
      throw new Error('MarketplaceService not initialized');
    }
    const result = await mainAppState.marketplaceService.uninstall(catalogId);
    if (result.type === 'mcp' && result.installedRef) {
      const mcpManager = mainAppState.sessionManager?.getMCPManager();
      if (mcpManager) {
        await mcpManager.removeServer(result.installedRef);
        mainAppState.sessionManager?.invalidateMcpServersCache();
      }
    }
    if (result.type === 'skill' || result.type === 'plugin') {
      mainAppState.sessionManager?.invalidateSkillsSetup();
    }
    if (result.type === 'plugin') {
      notifyPluginCommandsChanged();
    }
    return result;
  });

  ipcMain.handle('marketplace.sources.list', async (_event, forceRefresh = false) => {
    if (!mainAppState.marketplaceService) {
      throw new Error('MarketplaceService not initialized');
    }
    return mainAppState.marketplaceService.listSources(forceRefresh === true);
  });

  ipcMain.handle('marketplace.sources.add', async (_event, url: string, name?: string) => {
    if (!mainAppState.marketplaceService) {
      throw new Error('MarketplaceService not initialized');
    }
    return mainAppState.marketplaceService.addSource(url, name);
  });

  ipcMain.handle('marketplace.sources.remove', async (_event, sourceId: string) => {
    if (!mainAppState.marketplaceService) {
      throw new Error('MarketplaceService not initialized');
    }
    return mainAppState.marketplaceService.removeSource(sourceId);
  });

  ipcMain.handle('marketplace.setEnabled', async (_event, catalogId: string, enabled: boolean) => {
    if (!mainAppState.marketplaceService) {
      throw new Error('MarketplaceService not initialized');
    }
    const entry = await mainAppState.marketplaceService
      .list()
      .then((entries) => entries.find((item) => item.id === catalogId));
    const result = await mainAppState.marketplaceService.setEnabled(catalogId, enabled);
    if (entry?.type === 'mcp' && entry.installedRef) {
      await syncMcpAfterMarketplaceChange(entry.installedRef);
    }
    if (entry?.type === 'skill' || entry?.type === 'plugin') {
      mainAppState.sessionManager?.invalidateSkillsSetup();
    }
    if (entry?.type === 'plugin') {
      notifyPluginCommandsChanged();
    }
    return result;
  });
}
