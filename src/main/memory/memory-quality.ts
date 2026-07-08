import type { Message, TextContent } from '../../renderer/types';
import { extractTextFromContent } from './memory-utils';

export type SessionHealthReason = 'errored' | 'aborted' | 'degenerate';

export interface SessionHealthAssessment {
  healthy: boolean;
  reason?: SessionHealthReason;
}

function normalizePhrase(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function tokenizeWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+|[\u4e00-\u9fff]+/g) || [];
}

function hasRepeatedNormalizedPhrase(text: string): boolean {
  const counts = new Map<string, number>();
  const segments = [...text.split(/\n+/), ...text.split(/[.!?]+/)];
  for (const segment of segments) {
    const normalized = normalizePhrase(segment);
    if (normalized.length < 30) {
      continue;
    }
    const next = (counts.get(normalized) || 0) + 1;
    counts.set(normalized, next);
    if (next >= 3) {
      return true;
    }
  }
  return false;
}

function hasRepeatedFiveGram(text: string): boolean {
  const words = tokenizeWords(text);
  if (words.length < 5) {
    return false;
  }
  const counts = new Map<string, number>();
  for (let index = 0; index <= words.length - 5; index += 1) {
    const gram = words.slice(index, index + 5).join(' ');
    const next = (counts.get(gram) || 0) + 1;
    counts.set(gram, next);
    if (next >= 4) {
      return true;
    }
  }
  return false;
}

function hasLowLexicalDiversity(text: string): boolean {
  const words = tokenizeWords(text);
  if (words.length <= 200) {
    return false;
  }
  return new Set(words).size / words.length < 0.35;
}

export function isDegenerateText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  return (
    hasRepeatedNormalizedPhrase(normalized) ||
    hasRepeatedFiveGram(normalized) ||
    hasLowLexicalDiversity(normalized)
  );
}

function messageHasError(message: Message): boolean {
  if (message.localStatus === 'cancelled') {
    return true;
  }

  const flagged = message as Message & { isError?: boolean };
  if (flagged.isError === true) {
    return true;
  }

  for (const block of message.content) {
    if (block.type === 'tool_result' && block.isError) {
      return true;
    }
  }

  const text = extractTextFromContent(message.content);
  return /^\*\*Error\*\*:/m.test(text);
}

function isSuccessfulAssistantMessage(message: Message): boolean {
  if (message.role !== 'assistant') {
    return false;
  }
  const text = extractTextFromContent(message.content);
  if (!text) {
    return false;
  }
  return !messageHasError(message);
}

function getAssistantTextBlocks(message: Message): string[] {
  return message.content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text.trim())
    .filter(Boolean);
}

export function assessSessionHealth(messages: Message[]): SessionHealthAssessment {
  const successfulAssistantMessages = messages.filter(isSuccessfulAssistantMessage);
  if (!successfulAssistantMessages.length) {
    return { healthy: false, reason: 'aborted' };
  }

  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  const assistantWithContent = assistantMessages.filter(
    (message) => extractTextFromContent(message.content).length > 0
  );
  const lastAssistant = assistantWithContent[assistantWithContent.length - 1];
  if (lastAssistant && messageHasError(lastAssistant)) {
    return { healthy: false, reason: 'errored' };
  }

  for (const message of assistantMessages) {
    for (const text of getAssistantTextBlocks(message)) {
      if (isDegenerateText(text)) {
        return { healthy: false, reason: 'degenerate' };
      }
    }
  }

  return { healthy: true };
}
