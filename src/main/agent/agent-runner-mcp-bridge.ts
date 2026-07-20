import { Type, type TSchema } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { Message } from '../../renderer/types';
import type { MCPManager } from '../mcp/mcp-manager';
import { logError } from '../utils/logger';
import {
  beginPiiScrubSession,
  piiMaskedDetails,
  scrubToolArgsForEgress,
  unscrubUnknownForModel,
} from './pii-scrub-egress';
import { normalizeMcpToolResultForModel } from './tool-result-utils';

/**
 * Bridge MCP tools from MCPManager into ToolDefinition[] format for the agent SDK.
 * Each MCP tool becomes a customTool whose execute() delegates to mcpManager.callTool().
 *
 * PII scrubbing is applied here immediately before the unique MCP egress
 * (`mcpManager.callTool`), so unit tests of the MCP manager stay free of
 * config-store/electron imports.
 */
export function buildMcpCustomTools(mcpManager: MCPManager): ToolDefinition[] {
  // Deterministic order so tool registration (and any prompt snippets) stay stable.
  const mcpTools = [...mcpManager.getTools()].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  return mcpTools.map((mcpTool) => {
    // Wrap the raw JSON Schema inputSchema as a TypeBox TSchema
    const parameters = Type.Unsafe<Record<string, unknown>>(
      mcpTool.inputSchema as Record<string, unknown>
    );

    const toolDef: ToolDefinition<TSchema, unknown> = {
      name: mcpTool.name,
      label: `${mcpTool.serverName} → ${mcpTool.originalName || mcpTool.name}`,
      description: mcpTool.description || `MCP tool from ${mcpTool.serverName}`,
      parameters,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        try {
          const piiSession = beginPiiScrubSession();
          const scrubbedArgs = scrubToolArgsForEgress(
            params as Record<string, unknown>,
            piiSession
          );
          const result = await mcpManager.callTool(mcpTool.name, scrubbedArgs);
          const restored = unscrubUnknownForModel(result, piiSession);
          const normalizedResult = normalizeMcpToolResultForModel(restored);
          return {
            content: [{ type: 'text' as const, text: normalizedResult.text }],
            details: piiMaskedDetails(
              piiSession,
              normalizedResult.images.length > 0
                ? { openCoworkImages: normalizedResult.images }
                : undefined
            ),
          };
        } catch (err: unknown) {
          logError(`[AgentRunner] MCP tool ${mcpTool.name} failed:`, err);
          throw err instanceof Error ? err : new Error(String(err));
        }
      },
    };
    return toolDef;
  });
}

export function safeStringify(value: unknown, space = 0): string {
  try {
    return JSON.stringify(value, null, space);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return `[Unserializable: ${details}]`;
  }
}

export function summarizeMessageForLog(message: unknown): Record<string, unknown> {
  if (!message || typeof message !== 'object') {
    return { present: false };
  }

  const typedMessage = message as {
    role?: unknown;
    stopReason?: unknown;
    content?: unknown[];
    usage?: unknown;
  };
  const content = Array.isArray(typedMessage.content) ? typedMessage.content : [];

  return {
    present: true,
    role: typeof typedMessage.role === 'string' ? typedMessage.role : undefined,
    stopReason: typedMessage.stopReason ?? undefined,
    contentBlocks: content.length,
    contentTypes: content.slice(0, 8).map((block) => {
      if (!block || typeof block !== 'object') {
        return typeof block;
      }
      const type = (block as { type?: unknown }).type;
      return typeof type === 'string' ? type : 'unknown';
    }),
    usage: normalizeTokenUsage(typedMessage.usage),
  };
}

export function toErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }
  }
  const serialized = safeStringify(error);
  if (serialized.startsWith('[Unserializable:')) {
    return String(error);
  }
  return serialized;
}

export function normalizeTokenUsage(usage: unknown): Message['tokenUsage'] | undefined {
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }

  const raw = usage as {
    input?: unknown;
    output?: unknown;
    input_tokens?: unknown;
    output_tokens?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
  };

  const input = raw.input ?? raw.input_tokens ?? raw.inputTokens;
  const output = raw.output ?? raw.output_tokens ?? raw.outputTokens;

  if (typeof input !== 'number' || typeof output !== 'number') {
    return undefined;
  }

  return { input, output };
}
