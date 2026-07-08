import { describe, expect, it } from 'vitest';
import {
  buildTerminalErrorMessage,
  resolveMessageEndPayload,
} from '../../main/agent/agent-runner-message-end';
import { mt } from '../../main/i18n';

describe('resolveMessageEndPayload', () => {
  it('recovers a reasoning-only turn as a thinking block instead of erroring', () => {
    const result = resolveMessageEndPayload({
      message: { role: 'assistant', content: [] },
      streamedText: '',
      streamedThinking: 'The user asked for the time in Paris.',
    });

    expect(result.errorText).toBeUndefined();
    expect(result.shouldEmitMessage).toBe(true);
    expect(result.effectiveContent).toEqual([
      { type: 'thinking', thinking: 'The user asked for the time in Paris.' },
    ]);
  });

  it('reports an empty-success error only when there is no text and no reasoning', () => {
    const result = resolveMessageEndPayload({
      message: { role: 'assistant', content: [] },
      streamedText: '',
      streamedThinking: '   ',
    });

    expect(result.shouldEmitMessage).toBe(false);
    expect(result.errorText).toBe(mt('errEmptySuccess'));
  });

  it('emits normal text content untouched', () => {
    const result = resolveMessageEndPayload({
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      streamedText: '',
    });

    expect(result.errorText).toBeUndefined();
    expect(result.shouldEmitMessage).toBe(true);
    expect(result.effectiveContent).toEqual([{ type: 'text', text: 'Hello' }]);
  });

  it('does not promise an automatic retry for an empty-success error', () => {
    const message = buildTerminalErrorMessage(mt('errEmptySuccess'));
    expect(message).toContain(mt('errCheckConfigHint'));
    expect(message).not.toContain(mt('errRetryingHint'));
  });
});
