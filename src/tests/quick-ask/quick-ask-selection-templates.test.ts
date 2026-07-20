import { describe, expect, it } from 'vitest';
import en from '../../renderer/i18n/locales/en.json';
import fr from '../../renderer/i18n/locales/fr.json';
import {
  QUICK_ASK_SELECTION_ACTIONS,
  applyQuickAskActionTemplate,
} from '../../shared/quick-ask';

type QuickAskLocale = {
  actions: Record<string, string>;
  templates: Record<string, string>;
  uiLanguageName: string;
};

function quickAskBlock(locale: { quickAsk: QuickAskLocale }): QuickAskLocale {
  return locale.quickAsk;
}

describe('Quick Ask Sélection action templates', () => {
  it('exposes the four constant chip actions', () => {
    expect([...QUICK_ASK_SELECTION_ACTIONS]).toEqual([
      'summarize',
      'translate',
      'rephrase',
      'correct',
    ]);
  });

  it('keeps English templates byte-stable', () => {
    const block = quickAskBlock(en as { quickAsk: QuickAskLocale });
    expect(block.templates).toEqual({
      summarize: 'Summarize the following text concisely:\n\n{{text}}',
      translate: 'Translate the following text into {{language}}:\n\n{{text}}',
      rephrase: 'Rephrase the following text clearly, preserving meaning:\n\n{{text}}',
      correct:
        'Correct spelling, grammar, and clarity in the following text. Return only the corrected text:\n\n{{text}}',
    });
    expect(block.uiLanguageName).toBe('English');
  });

  it('keeps French templates byte-stable', () => {
    const block = quickAskBlock(fr as { quickAsk: QuickAskLocale });
    expect(block.templates).toEqual({
      summarize: 'Résume le texte suivant de façon concise :\n\n{{text}}',
      translate: 'Traduis le texte suivant en {{language}} :\n\n{{text}}',
      rephrase: 'Reformule clairement le texte suivant, en préservant le sens :\n\n{{text}}',
      correct:
        'Corrige l’orthographe, la grammaire et la clarté du texte suivant. Renvoie uniquement le texte corrigé :\n\n{{text}}',
    });
    expect(block.uiLanguageName).toBe('français');
  });

  it('applies templates with {{text}} and {{language}} placeholders', () => {
    const rendered = applyQuickAskActionTemplate(
      'Translate the following text into {{language}}:\n\n{{text}}',
      { text: 'Bonjour', language: 'English' }
    );
    expect(rendered).toBe('Translate the following text into English:\n\nBonjour');
  });

  it('has action labels and templates for every chip in en/fr', () => {
    for (const locale of [en, fr] as Array<{ quickAsk: QuickAskLocale }>) {
      const block = quickAskBlock(locale);
      for (const action of QUICK_ASK_SELECTION_ACTIONS) {
        expect(typeof block.actions[action]).toBe('string');
        expect(block.actions[action]!.length).toBeGreaterThan(0);
        expect(typeof block.templates[action]).toBe('string');
        expect(block.templates[action]!).toContain('{{text}}');
      }
      expect(block.templates.translate).toContain('{{language}}');
    }
  });
});
