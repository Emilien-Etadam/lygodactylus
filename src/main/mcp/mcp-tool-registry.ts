import { BrowserWindow } from 'electron';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { log, logError } from '../utils/logger.js';
import { createUniqueMcpToolName, sanitizeMcpToolSegment } from './mcp-tool-naming.js';
import type { MCPServerConfig, MCPTool, RefreshToolsResult } from './mcp-types.js';

const MCP_LIST_TOOLS_TIMEOUT_MS = 5 * 60 * 1000;

export interface MCPToolRegistryContext {
  clients: Map<string, Client>;
  serverConfigs: Map<string, MCPServerConfig>;
  reconnectingServers: Set<string>;
  connectionStatus: Map<string, 'connecting' | 'connected' | 'failed'>;
  getToolMap(): Map<string, MCPTool>;
  setToolMap(tools: Map<string, MCPTool>): void;
  disconnectServer(serverId: string): Promise<void>;
  connectServer(config: MCPServerConfig): Promise<void>;
}

export async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

export async function refreshTools(ctx: MCPToolRegistryContext): Promise<void> {
  log('[MCPManager] Refreshing tools from all servers');

  const toolResults: RefreshToolsResult[] = await Promise.all(
    Array.from(ctx.clients.entries()).map(async ([serverId, client]) => {
      const config = ctx.serverConfigs.get(serverId);
      if (!config) {
        return { kind: 'success', serverId, tools: [] as MCPTool[] };
      }

      log(
        `[MCPManager] Fetching tools from ${config.name} (timeout: ${MCP_LIST_TOOLS_TIMEOUT_MS}ms)...`
      );
      try {
        const listToolsResult = await raceWithTimeout(
          client.listTools(),
          MCP_LIST_TOOLS_TIMEOUT_MS,
          `listTools timeout after ${MCP_LIST_TOOLS_TIMEOUT_MS}ms`
        );
        log(`[MCPManager] Raw tools from ${config.name}:`, listToolsResult);

        const usedToolNames = new Set<string>();
        const serverKey = sanitizeMcpToolSegment(config.name, 'server');
        const tools = [...listToolsResult.tools]
          .sort((left, right) => {
            const leftName = left.name || '';
            const rightName = right.name || '';
            if (leftName < rightName) return -1;
            if (leftName > rightName) return 1;
            return 0;
          })
          .map((tool) => {
            const originalToolName =
              typeof tool.name === 'string' && tool.name.trim().length > 0 ? tool.name : 'tool';
            return {
              name: createUniqueMcpToolName(
                `mcp__${serverKey}__${sanitizeMcpToolSegment(originalToolName, 'tool')}`,
                usedToolNames
              ),
              originalName: originalToolName,
              description: tool.description || '',
              inputSchema: {
                type: 'object',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                properties: (tool.inputSchema as any)?.properties || {},
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                required: (tool.inputSchema as any)?.required,
              },
              serverId,
              serverName: config.name,
            } satisfies MCPTool;
          });

        log(`[MCPManager] ✓ Loaded ${tools.length} tools from ${config.name}`);
        return { kind: 'success' as const, serverId, tools };
      } catch (error) {
        return { kind: 'error' as const, serverId, error };
      }
    })
  );

  const newTools = new Map<string, MCPTool>();
  for (const result of toolResults) {
    if (result.kind === 'success') {
      for (const tool of result.tools) newTools.set(tool.name, tool);
      continue;
    }

    const errMsg = result.error instanceof Error ? result.error.message : String(result.error);
    logError(`[MCPManager] ❌ Error listing tools from ${result.serverId}:`, errMsg);

    try {
      const win = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
      win?.webContents.send('server-event', {
        type: 'mcp:tools-refresh-error',
        payload: { serverId: result.serverId, error: errMsg },
      });
    } catch {
      // Best-effort notification; logging already happened above
    }

    const config = ctx.serverConfigs.get(result.serverId);
    if (config && config.name.toLowerCase().includes('chrome')) {
      log('[MCPManager] Chrome server may need reconnection. Trying to refresh...');
    }
  }

  ctx.setToolMap(newTools);
  log(`[MCPManager] Total tools available: ${newTools.size}`);
}

export function getTools(ctx: Pick<MCPToolRegistryContext, 'getToolMap'>): MCPTool[] {
  return Array.from(ctx.getToolMap().values());
}

export function getTool(
  ctx: Pick<MCPToolRegistryContext, 'getToolMap'>,
  toolName: string
): MCPTool | undefined {
  return ctx.getToolMap().get(toolName);
}
