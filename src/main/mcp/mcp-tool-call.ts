import { log, logCtx, logCtxError, logError, logTiming, logWarn } from '../utils/logger.js';
import { refreshTools, raceWithTimeout, type MCPToolRegistryContext } from './mcp-tool-registry.js';
import type { MCPTool } from './mcp-types.js';

const MCP_TOOL_CALL_TIMEOUT_MS = 5 * 60 * 1000;

function resolveActualToolName(toolName: string, tool: MCPTool): string {
  if (tool.originalName) {
    return tool.originalName;
  }
  if (!toolName.startsWith('mcp__')) {
    return toolName;
  }

  const remainder = toolName.slice('mcp__'.length);
  const separatorIndex = remainder.indexOf('__');
  return separatorIndex === -1 ? toolName : remainder.slice(separatorIndex + 2);
}

export async function callTool(
  ctx: MCPToolRegistryContext,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const tool = ctx.getToolMap().get(toolName);
  if (!tool) {
    throw new Error(`MCP tool not found: ${toolName}`);
  }

  logCtx(
    `[MCPManager] Calling tool ${resolveActualToolName(toolName, tool)} on server ${tool.serverName}`
  );

  const callStartTime = Date.now();
  const maxRetries = 2;
  const deadline = Date.now() + MCP_TOOL_CALL_TIMEOUT_MS;
  let compatHotReloadTried = false;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const currentTool = ctx.getToolMap().get(toolName) ?? tool;
    const actualToolName = resolveActualToolName(toolName, currentTool);

    try {
      const client = ctx.clients.get(currentTool.serverId);
      if (!client) {
        throw new Error(`MCP server not connected: ${currentTool.serverId}`);
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(`Tool call timeout after ${MCP_TOOL_CALL_TIMEOUT_MS}ms`);
      }

      const result = await raceWithTimeout(
        client.callTool({ name: actualToolName, arguments: args }),
        remainingMs,
        `Tool call timeout after ${MCP_TOOL_CALL_TIMEOUT_MS}ms`
      );

      const toolErrorMessage = extractStructuredToolErrorMessage(result);
      if (shouldReconnectOnStructuredToolError(toolErrorMessage)) {
        throw new Error(toolErrorMessage);
      }
      if (
        !compatHotReloadTried &&
        shouldHotReloadGuiVisionServer(currentTool.serverName, actualToolName, toolErrorMessage)
      ) {
        compatHotReloadTried = true;
        logWarn(
          `[MCPManager] Detected GUI vision compatibility error (${toolErrorMessage}). Reconnecting server ${currentTool.serverName} and retrying once.`
        );
        if (await reconnectServer(ctx, currentTool.serverId)) {
          continue;
        }
      }

      logTiming(`MCP tool ${actualToolName}`, callStartTime);
      return result;
    } catch (error: unknown) {
      lastError = error;
      const errorMsg = error instanceof Error ? error.message : String(error);
      logCtxError(
        `[MCPManager] Error calling tool ${toolName} (attempt ${attempt + 1}/${maxRetries + 1}):`,
        errorMsg
      );

      if (attempt >= maxRetries) {
        break;
      }

      if (isReconnectableErrorText(errorMsg)) {
        log(
          `[MCPManager] Reconnectable MCP error detected for ${currentTool.serverName}; attempting reconnect...`
        );
        if (await reconnectServer(ctx, currentTool.serverId)) {
          continue;
        }
        logWarn(
          `[MCPManager] Reconnect attempt failed for ${currentTool.serverName}, will retry after backoff`
        );
        const delay = Math.min(2000 * Math.pow(1.5, attempt), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (errorMsg.includes('timeout')) {
        if (deadline - Date.now() <= 0) {
          break;
        }
        log('[MCPManager] Tool call timeout detected, retrying within shared deadline...');
        const delay = Math.min(2000 * Math.pow(1.5, attempt), 10000);
        const remainingAfterDelay = deadline - Date.now();
        if (remainingAfterDelay <= 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(delay, remainingAfterDelay)));
        continue;
      }

      break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function reconnectServer(
  ctx: MCPToolRegistryContext,
  serverId: string
): Promise<boolean> {
  if (ctx.reconnectingServers.has(serverId)) {
    logWarn(`[MCPManager] Skipping reconnectServer for ${serverId}: reconnect already in progress`);
    return false;
  }

  const config = ctx.serverConfigs.get(serverId);
  if (!config || !config.enabled) {
    logWarn(`[MCPManager] Cannot reconnect server ${serverId}: config missing or disabled`);
    return false;
  }

  ctx.reconnectingServers.add(serverId);
  ctx.connectionStatus.set(serverId, 'connecting');

  try {
    await ctx.disconnectServer(serverId);
    await ctx.connectServer(config);
    await refreshTools(ctx);
    log(`[MCPManager] Reconnected server ${config.name} (${serverId})`);
    return true;
  } catch (error) {
    logError(`[MCPManager] Failed to reconnect server ${serverId}:`, error);
    return false;
  } finally {
    ctx.reconnectingServers.delete(serverId);
  }
}

export function extractStructuredToolErrorMessage(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return '';
  }

  const topLevelIsError = (result as { isError?: unknown }).isError === true;
  const content = Array.isArray((result as { content?: unknown }).content)
    ? ((result as { content?: unknown[] }).content ?? [])
    : [];

  for (const item of content) {
    if (!item || typeof item !== 'object' || (item as { type?: string }).type !== 'text') {
      continue;
    }

    const text = (item as { text?: unknown }).text;
    if (typeof text !== 'string' || !text.trim()) {
      continue;
    }

    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
        if (parsed.error === true && typeof parsed.message === 'string' && parsed.message.trim()) {
          return parsed.message.trim();
        }
      } catch {
        // Ignore malformed JSON payloads
      }
    }

    if (topLevelIsError && isReconnectableErrorText(trimmed)) {
      return trimmed;
    }
  }

  return '';
}

export function isReconnectableErrorText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    Boolean(normalized) &&
    (normalized === 'not connected' ||
      normalized.includes('mcp server not connected') ||
      normalized.includes('connection closed'))
  );
}

export function shouldReconnectOnStructuredToolError(errorMessage: string): boolean {
  return Boolean(errorMessage) && isReconnectableErrorText(errorMessage);
}

export function shouldHotReloadGuiVisionServer(
  serverName: string,
  actualToolName: string,
  errorMessage: string
): boolean {
  return (
    Boolean(errorMessage) &&
    actualToolName === 'gui_verify_vision' &&
    serverName.toLowerCase().includes('gui') &&
    (errorMessage.includes('Unsupported parameter: max_output_tokens') ||
      errorMessage.includes('Instructions are required') ||
      errorMessage.includes('Stream must be set to true'))
  );
}
