import { describe, expect, it } from 'vitest';
import type { Message } from '../../renderer/types';
import { assessSessionHealth, isDegenerateText } from '../../main/memory/memory-quality';

const COFFEE_FILTER_LINE =
  'The coffee filter needs replacement before brewing another pot of coffee today';

function makeAssistantMessage(text: string, timestamp = 2): Message {
  return {
    id: `assistant-${timestamp}`,
    sessionId: 'session-1',
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp,
  };
}

function makeUserMessage(text: string, timestamp = 1): Message {
  return {
    id: `user-${timestamp}`,
    sessionId: 'session-1',
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp,
  };
}

describe('isDegenerateText', () => {
  it('detects repeated normalized lines of at least 30 characters', () => {
    const text = [COFFEE_FILTER_LINE, COFFEE_FILTER_LINE, COFFEE_FILTER_LINE].join('\n');
    expect(isDegenerateText(text)).toBe(true);
  });

  it('detects repeated 5-grams at least four times', () => {
    const phrase = 'alpha beta gamma delta epsilon';
    const text = Array.from({ length: 5 }, () => phrase).join(' ');
    expect(isDegenerateText(text)).toBe(true);
  });

  it('detects low lexical diversity on long natural language text', () => {
    const filler = 'memory loop memory loop memory loop memory loop';
    const text = Array.from({ length: 60 }, () => filler).join(' ');
    expect(isDegenerateText(text)).toBe(true);
  });

  it('does not flag a legitimate bullet list', () => {
    const text = [
      '- Configure the gateway token rotation schedule for nightly maintenance',
      '- Verify remote gateway health checks after deployment completes',
      '- Document rollback steps for the production gateway cluster',
      '- Notify the platform team about the credential rotation window',
    ].join('\n');
    expect(isDegenerateText(text)).toBe(false);
  });

  it('does not flag code-like content with repeated keywords', () => {
    const text = [
      'function rotateToken(token: string): string {',
      '  return token.replace(/-/g, "");',
      '}',
      'export function verifyGateway(url: string): boolean {',
      '  return url.startsWith("https://");',
      '}',
    ].join('\n');
    expect(isDegenerateText(text)).toBe(false);
  });

  it('does not flag short normal text', () => {
    expect(isDegenerateText('Gateway token rotation completed successfully.')).toBe(false);
  });
});

describe('assessSessionHealth', () => {
  it('marks sessions without a successful assistant response as aborted', () => {
    const result = assessSessionHealth([
      makeUserMessage('Please rotate the gateway token.'),
      makeUserMessage('Any update on the gateway token rotation?'),
    ]);
    expect(result).toEqual({ healthy: false, reason: 'aborted' });
  });

  it('marks sessions whose last assistant response is an error as errored', () => {
    const result = assessSessionHealth([
      makeUserMessage('Please rotate the gateway token.'),
      makeAssistantMessage('Gateway token rotation completed successfully.', 2),
      makeUserMessage('Can you retry the deployment?', 3),
      makeAssistantMessage('**Error**: model timeout while finishing deployment.', 4),
    ]);
    expect(result).toEqual({ healthy: false, reason: 'errored' });
  });

  it('marks sessions with degenerate assistant text as degenerate', () => {
    const degenerateReply = [COFFEE_FILTER_LINE, COFFEE_FILTER_LINE, COFFEE_FILTER_LINE].join('\n');
    const result = assessSessionHealth([
      makeUserMessage('What should I do with the coffee machine?'),
      makeAssistantMessage(degenerateReply, 2),
    ]);
    expect(result).toEqual({ healthy: false, reason: 'degenerate' });
  });

  it('accepts healthy sessions with a successful final assistant response', () => {
    const result = assessSessionHealth([
      makeUserMessage('Please rotate the gateway token.'),
      makeAssistantMessage('Gateway token rotation completed successfully.', 2),
    ]);
    expect(result).toEqual({ healthy: true });
  });
});
