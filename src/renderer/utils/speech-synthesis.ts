/**
 * Thin offline speechSynthesis helper (Chromium built-in API, no network).
 * One utterance at a time; falls back silently when the API is unavailable.
 */
import { useAppStore } from '../store';
import { toSpeakableText } from './speakable-text';

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;
const CYRILLIC_RE = /[\u0400-\u04FF]/;

function normalizeLang(lang: string): string {
  const base = lang.trim().toLowerCase().split('-')[0] || 'en';
  if (base === 'nb' || base === 'nn') {
    return 'no';
  }
  return base;
}

/** Simple script-based language hint; falls back to the UI language. */
export function detectSpeechLanguage(text: string, fallbackLang: string): string {
  const sample = text.slice(0, 800);
  if (CJK_RE.test(sample)) {
    return 'zh';
  }
  if (CYRILLIC_RE.test(sample)) {
    return 'uk';
  }
  return normalizeLang(fallbackLang);
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) {
    return null;
  }
  const base = normalizeLang(lang);
  return voices.find((voice) => normalizeLang(voice.lang) === base) ?? null;
}

function isSpeechSynthesisAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}

export function stopSpeechSynthesis(): void {
  if (!isSpeechSynthesisAvailable()) {
    useAppStore.getState().setSpeakingMessageId(null);
    return;
  }
  window.speechSynthesis.cancel();
  useAppStore.getState().setSpeakingMessageId(null);
}

export function toggleSpeechSynthesis(options: {
  messageId: string;
  markdown: string;
  uiLanguage: string;
}): void {
  if (!isSpeechSynthesisAvailable()) {
    return;
  }

  const { messageId, markdown, uiLanguage } = options;
  const currentId = useAppStore.getState().speakingMessageId;
  if (currentId === messageId) {
    stopSpeechSynthesis();
    return;
  }

  const speakable = toSpeakableText(markdown);
  if (!speakable) {
    return;
  }

  // Cancel any in-flight utterance before starting a new one.
  window.speechSynthesis.cancel();

  const lang = detectSpeechLanguage(speakable, uiLanguage);
  const utterance = new SpeechSynthesisUtterance(speakable);
  utterance.lang = lang;
  const voice = pickVoice(lang);
  if (voice) {
    utterance.voice = voice;
  }

  const clearIfCurrent = () => {
    if (useAppStore.getState().speakingMessageId === messageId) {
      useAppStore.getState().setSpeakingMessageId(null);
    }
  };
  utterance.onend = clearIfCurrent;
  utterance.onerror = clearIfCurrent;

  useAppStore.getState().setSpeakingMessageId(messageId);

  // Chromium sometimes drops speak() called immediately after cancel().
  window.setTimeout(() => {
    if (useAppStore.getState().speakingMessageId !== messageId) {
      return;
    }
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      useAppStore.getState().setSpeakingMessageId(null);
    }
  }, 0);
}
