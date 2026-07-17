import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enTranslations from './locales/en.json';
import zhTranslations from './locales/zh.json';
import esTranslations from './locales/es.json';
import frTranslations from './locales/fr.json';
import deTranslations from './locales/de.json';
import itTranslations from './locales/it.json';
import ukTranslations from './locales/uk.json';
import plTranslations from './locales/pl.json';
import svTranslations from './locales/sv.json';
import noTranslations from './locales/no.json';
import nlTranslations from './locales/nl.json';
import roTranslations from './locales/ro.json';

const initPromise = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: enTranslations,
      },
      zh: {
        translation: zhTranslations,
      },
      es: {
        translation: esTranslations,
      },
      fr: {
        translation: frTranslations,
      },
      de: {
        translation: deTranslations,
      },
      it: {
        translation: itTranslations,
      },
      uk: {
        translation: ukTranslations,
      },
      pl: {
        translation: plTranslations,
      },
      sv: {
        translation: svTranslations,
      },
      no: {
        translation: noTranslations,
      },
      nl: {
        translation: nlTranslations,
      },
      ro: {
        translation: roTranslations,
      },
    },
    // Default language; Norwegian nb/nn fall back to no
    fallbackLng: { nb: ['no'], nn: ['no'], default: ['fr'] },
    supportedLngs: ['en', 'zh', 'es', 'fr', 'de', 'it', 'uk', 'pl', 'sv', 'no', 'nl', 'ro'],
    nonExplicitSupportedLngs: true, // Accept regional variants, e.g. es-ES → es, zh-CN → zh
    interpolation: {
      escapeValue: false, // React already handles XSS
    },
    pluralSeparator: '_',
    contextSeparator: '_',
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  });

// Mirror the renderer language into the main-process config so backend-produced
// strings (errors, dialogs, the default config-set name) match the UI. Fires for
// the initially detected language and whenever the user switches.
let lastSyncedLanguage: string | undefined;
function syncBackendLanguage(lng?: string): void {
  if (!lng || lng === lastSyncedLanguage) return;
  lastSyncedLanguage = lng;
  try {
    void window.electronAPI?.config?.save?.({ uiLanguage: lng });
  } catch {
    /* ignore: browser/dev mode without electronAPI */
  }
}

i18n.on('languageChanged', syncBackendLanguage);
void initPromise.then(() => syncBackendLanguage(i18n.language));

export default i18n;
