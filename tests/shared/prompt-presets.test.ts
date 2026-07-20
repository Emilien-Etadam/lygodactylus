import { describe, expect, it } from 'vitest';

import {
  applyVariableValues,
  buildPresetInsertionText,
  detectTemplateVariables,
  resolveDynamicTokens,
} from '../../src/shared/prompt-presets';

describe('detectTemplateVariables', () => {
  it('returns an empty list when there are no variables', () => {
    expect(detectTemplateVariables('Hello world')).toEqual([]);
    expect(detectTemplateVariables('')).toEqual([]);
    expect(detectTemplateVariables('{date} and {os}')).toEqual([]);
  });

  it('detects variables in first-seen order and collapses duplicates', () => {
    expect(
      detectTemplateVariables('Summarize {{sujet}} in {{langue}}. Again: {{sujet}}.')
    ).toEqual(['sujet', 'langue']);
  });

  it('only matches innermost well-formed variables when nested', () => {
    expect(detectTemplateVariables('{{a{{b}}}}')).toEqual(['b']);
    expect(detectTemplateVariables('outer {{ok}} and {{a{{inner}}}}')).toEqual(['ok', 'inner']);
  });

  it('merges variables across text and system prompt', () => {
    expect(detectTemplateVariables('Body {{sujet}}', 'Tone: {{tone}}')).toEqual(['sujet', 'tone']);
  });

  it('trims whitespace inside braces', () => {
    expect(detectTemplateVariables('Hello {{  name  }}')).toEqual(['name']);
  });
});

describe('resolveDynamicTokens', () => {
  it('resolves {date} and {os}', () => {
    expect(
      resolveDynamicTokens('Today is {date} on {os}', {
        date: '2026-07-20',
        os: 'linux',
      })
    ).toBe('Today is 2026-07-20 on linux');
  });

  it('leaves unknown brace tokens untouched', () => {
    expect(resolveDynamicTokens('Keep {unknown} and {{sujet}}', { date: '2026-01-01', os: 'win32' })).toBe(
      'Keep {unknown} and {{sujet}}'
    );
  });

  it('replaces every occurrence', () => {
    expect(resolveDynamicTokens('{date}/{date}/{os}', { date: 'D', os: 'O' })).toBe('D/D/O');
  });
});

describe('applyVariableValues + buildPresetInsertionText', () => {
  it('substitutes variables and leaves missing ones intact', () => {
    expect(applyVariableValues('A {{a}} B {{b}}', { a: '1' })).toBe('A 1 B {{b}}');
  });

  it('prefixes optional system prompt on the user draft and resolves tokens', () => {
    const text = buildPresetInsertionText(
      {
        text: 'Topic: {{sujet}} ({date})',
        systemPrompt: 'Reply in {{langue}} on {os}',
      },
      { sujet: 'KV cache', langue: 'French' },
      { date: '2026-07-20', os: 'darwin' }
    );
    expect(text).toBe('Reply in French on darwin\n\nTopic: KV cache (2026-07-20)');
  });

  it('omits system prompt when empty', () => {
    expect(
      buildPresetInsertionText(
        { text: 'Hello {{name}}', systemPrompt: '  ' },
        { name: 'Ada' },
        { date: '2026-07-20', os: 'linux' }
      )
    ).toBe('Hello Ada');
  });
});
