import { describe, expect, it } from 'vitest';
import { resolveWhisperLanguage, UI_TO_WHISPER_LANGUAGE } from '../../shared/stt/language';

describe('resolveWhisperLanguage', () => {
  it('maps all 12 UI locales to whisper codes', () => {
    expect(Object.keys(UI_TO_WHISPER_LANGUAGE).sort()).toEqual(
      ['de', 'en', 'es', 'fr', 'it', 'nl', 'no', 'pl', 'ro', 'sv', 'uk', 'zh'].sort()
    );
    expect(resolveWhisperLanguage('ui', 'fr')).toBe('fr');
    expect(resolveWhisperLanguage('ui', 'zh-CN')).toBe('zh');
    expect(resolveWhisperLanguage('ui', 'nb')).toBe('en'); // unknown → en
    expect(resolveWhisperLanguage('ui', 'no')).toBe('no');
  });

  it('returns auto when mode is auto', () => {
    expect(resolveWhisperLanguage('auto', 'de')).toBe('auto');
  });
});
