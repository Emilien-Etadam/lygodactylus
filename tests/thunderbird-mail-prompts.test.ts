import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// mailPrompts.js is a plain CommonJS-compatible browser script (UMD-ish); load
// it through require so we exercise the exact file shipped in the addon.
const require = createRequire(import.meta.url);
const mailPrompts = require('../extension-thunderbird/lib/mailPrompts.js') as {
  TONES: { id: string; label: string }[];
  buildCustomPrompt: (action: string, opts: Record<string, unknown>) => string;
  buildWebActionPayload: (
    action: string,
    opts: Record<string, unknown>
  ) => {
    action: string;
    content: string;
    targetLang: string | null;
    prompt: string | null;
  };
  isComposeAction: (action: string) => boolean;
};

describe('buildWebActionPayload', () => {
  it('maps translate to the native action with a target language', () => {
    const p = mailPrompts.buildWebActionPayload('translate', {
      content: 'Hallo Welt',
      targetLang: 'fr',
    });
    expect(p.action).toBe('translate');
    expect(p.targetLang).toBe('fr');
    expect(p.prompt).toBeNull();
    expect(p.content).toBe('Hallo Welt');
  });

  it('maps every other action to custom with a built prompt', () => {
    const p = mailPrompts.buildWebActionPayload('summarize', {
      content: 'body',
      language: 'français',
    });
    expect(p.action).toBe('custom');
    expect(p.targetLang).toBeNull();
    expect(p.prompt).toContain('Résume');
    expect(p.prompt).toContain('français');
  });

  it('injects the requested tone into rephrase / suggest-reply', () => {
    const reply = mailPrompts.buildCustomPrompt('suggest-reply', {
      language: 'anglais',
      tone: 'formel',
    });
    expect(reply).toContain('anglais');
    expect(reply).toContain('formel');

    const rephrase = mailPrompts.buildCustomPrompt('rephrase', { tone: 'concis' });
    expect(rephrase).toContain('concis');
  });

  it('passes a custom prompt through verbatim (trimmed)', () => {
    const p = mailPrompts.buildWebActionPayload('custom', {
      content: 'x',
      customPrompt: '  liste les actions  ',
    });
    expect(p.action).toBe('custom');
    expect(p.prompt).toBe('liste les actions');
  });
});

describe('isComposeAction', () => {
  it('flags the actions that write back into the compose window', () => {
    expect(mailPrompts.isComposeAction('suggest-reply')).toBe(true);
    expect(mailPrompts.isComposeAction('rephrase')).toBe(true);
    expect(mailPrompts.isComposeAction('improve')).toBe(true);
    expect(mailPrompts.isComposeAction('summarize')).toBe(false);
    expect(mailPrompts.isComposeAction('translate')).toBe(false);
  });
});

describe('TONES', () => {
  it('exposes stable ids for the submenu', () => {
    expect(mailPrompts.TONES.map((t) => t.id)).toContain('formel');
    expect(mailPrompts.TONES.every((t) => t.id && t.label)).toBe(true);
  });
});
