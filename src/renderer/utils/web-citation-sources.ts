import type { ContentBlock, Message, TraceStep, ToolResultContent, ToolUseContent } from '../types';
import {
  extractWebCitationSources,
  extractWebCitationSourcesFromTraceStep,
  isWebCitationToolName,
  mergeWebCitationSources,
  type WebCitationSource,
} from '../../shared/web-citation';

function getContentBlocks(message: Message): ContentBlock[] {
  const raw = message.content as unknown;
  return Array.isArray(raw) ? (raw as ContentBlock[]) : [];
}

/** Messages belonging to the same user turn as `assistantMessage` (exclusive of prior turns). */
export function getTurnMessages(messages: Message[], assistantMessage: Message): Message[] {
  const anchorIndex = messages.findIndex((item) => item.id === assistantMessage.id);
  if (anchorIndex < 0) {
    return [assistantMessage];
  }

  let turnStart = 0;
  for (let i = anchorIndex; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      turnStart = i;
      break;
    }
  }

  let turnEnd = messages.length;
  for (let i = anchorIndex + 1; i < messages.length; i += 1) {
    if (messages[i]?.role === 'user') {
      turnEnd = i;
      break;
    }
  }

  return messages.slice(turnStart, turnEnd);
}

function collectToolNameByUseId(turnMessages: Message[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const message of turnMessages) {
    for (const block of getContentBlocks(message)) {
      if (block.type === 'tool_use') {
        const toolUse = block as ToolUseContent;
        map.set(toolUse.id, toolUse.name);
      }
    }
  }
  return map;
}

function collectSourcesFromTurnMessages(turnMessages: Message[]): WebCitationSource[][] {
  const toolNames = collectToolNameByUseId(turnMessages);
  const batches: WebCitationSource[][] = [];

  for (const message of turnMessages) {
    for (const block of getContentBlocks(message)) {
      if (block.type !== 'tool_result') continue;
      const result = block as ToolResultContent;
      const toolName = toolNames.get(result.toolUseId);
      if (!isWebCitationToolName(toolName)) continue;
      const sources = extractWebCitationSources(result.content);
      if (sources.length > 0) {
        batches.push(sources);
      }
    }
  }

  return batches;
}

function collectSourcesFromTraceSteps(
  turnMessages: Message[],
  traceSteps: TraceStep[]
): WebCitationSource[][] {
  const toolNames = collectToolNameByUseId(turnMessages);
  const turnToolIds = new Set(toolNames.keys());
  const batches: WebCitationSource[][] = [];

  for (const step of traceSteps) {
    const toolName = step.toolName;
    const isWeb =
      isWebCitationToolName(toolName) ||
      (turnToolIds.has(step.id) && isWebCitationToolName(toolNames.get(step.id)));
    if (!isWeb) continue;

    const sources = extractWebCitationSourcesFromTraceStep({
      toolName: toolName || toolNames.get(step.id),
      toolOutput: step.toolOutput,
      content: step.content,
      type: step.type,
    });
    if (sources.length > 0) {
      batches.push(sources);
    }
  }

  return batches;
}

/**
 * Collect numbered web sources for the turn that produced `assistantMessage`.
 * Prefers full tool_result message content; falls back to truncated trace toolOutput.
 */
export function collectWebSourcesForAssistantMessage(
  messages: Message[],
  assistantMessage: Message,
  traceSteps: TraceStep[]
): WebCitationSource[] {
  if (assistantMessage.role !== 'assistant') {
    return [];
  }

  const turnMessages = getTurnMessages(messages, assistantMessage);
  // Message tool_results first (full text), then traces (may be truncated to 800 chars).
  return mergeWebCitationSources([
    ...collectSourcesFromTurnMessages(turnMessages),
    ...collectSourcesFromTraceSteps(turnMessages, traceSteps),
  ]);
}

export function getAssistantPlainText(message: Message): string {
  return getContentBlocks(message)
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('\n');
}
