/**
 * Map UI locale codes (12 languages) to whisper.cpp `--language` codes.
 * `auto` leaves detection to whisper; `ui` resolves via the active UI language.
 */

export type SpeechToTextLanguageMode = 'auto' | 'ui';

/** UI locales shipped by the app → whisper language codes. */
export const UI_TO_WHISPER_LANGUAGE: Record<string, string> = {
  en: 'en',
  zh: 'zh',
  es: 'es',
  fr: 'fr',
  de: 'de',
  it: 'it',
  uk: 'uk',
  pl: 'pl',
  sv: 'sv',
  no: 'no',
  nl: 'nl',
  ro: 'ro',
};

/**
 * Resolve the whisper `--language` value from settings + current UI language.
 */
export function resolveWhisperLanguage(
  mode: SpeechToTextLanguageMode | string | undefined,
  uiLanguage: string | undefined
): string {
  if (mode === 'auto') {
    return 'auto';
  }

  const ui = (uiLanguage || 'en').toLowerCase().split('-')[0] || 'en';
  return UI_TO_WHISPER_LANGUAGE[ui] ?? 'en';
}
