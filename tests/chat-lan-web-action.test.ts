import { describe, expect, it } from 'vitest';
import {
  MAX_WEB_ACTION_CONTENT_CHARS,
  buildWebActionSystemPrompt,
  validateWebActionRequest,
  type WebActionRequest,
} from '../src/main/chat-lan-server/web-action';

function baseRequest(overrides: Partial<WebActionRequest> = {}): WebActionRequest {
  return {
    action: 'summarize',
    content: 'Hello world',
    url: 'https://example.com',
    title: 'Example',
    selection: false,
    targetLang: null,
    prompt: null,
    ...overrides,
  };
}

describe('web-action validation', () => {
  it('requires targetLang for translate', () => {
    expect(
      validateWebActionRequest(
        baseRequest({ action: 'translate', targetLang: null })
      )
    ).toBe('missing_target_lang');
    expect(
      validateWebActionRequest(
        baseRequest({ action: 'translate', targetLang: 'fr' })
      )
    ).toBeNull();
  });

  it('requires prompt for extract and custom', () => {
    expect(
      validateWebActionRequest(baseRequest({ action: 'extract', prompt: null }))
    ).toBe('missing_prompt');
    expect(
      validateWebActionRequest(baseRequest({ action: 'custom', prompt: '  ' }))
    ).toBe('missing_prompt');
  });

  it('rejects content beyond limit with explicit error', () => {
    const oversized = 'x'.repeat(MAX_WEB_ACTION_CONTENT_CHARS + 1);
    expect(validateWebActionRequest(baseRequest({ content: oversized }))).toBe(
      'content_too_large'
    );
  });

  it('builds action-specific system prompts', () => {
    const translatePrompt = buildWebActionSystemPrompt(
      baseRequest({ action: 'translate', targetLang: 'fr' })
    );
    expect(translatePrompt).toContain('fr');
    expect(translatePrompt).toContain('traduis');

    const summarizePrompt = buildWebActionSystemPrompt(
      baseRequest({ action: 'summarize' })
    );
    expect(summarizePrompt).toContain('résumes');

    const extractPrompt = buildWebActionSystemPrompt(
      baseRequest({ action: 'extract', prompt: 'all links' })
    );
    expect(extractPrompt).toContain('all links');
    expect(extractPrompt).toContain('Markdown');
  });
});
