import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { useAppConfig } from '../../store/selectors';
import {
  DEFAULT_QUICK_ASK_SELECTION_SHORTCUT,
  DEFAULT_QUICK_ASK_SHORTCUT,
  isValidQuickAskShortcut,
  normalizeQuickAskShortcut,
} from '../../../shared/quick-ask';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

type ShortcutField = 'ask' | 'selection';

export function SettingsQuickAsk() {
  const { t } = useTranslation();
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const appConfig = useAppConfig();
  const enabled = appConfig?.quickAskEnabled === true;
  const savedAskShortcut =
    normalizeQuickAskShortcut(appConfig?.quickAskShortcut) || DEFAULT_QUICK_ASK_SHORTCUT;
  const savedSelectionShortcut =
    normalizeQuickAskShortcut(appConfig?.quickAskSelectionShortcut) ||
    DEFAULT_QUICK_ASK_SELECTION_SHORTCUT;

  const [askDraft, setAskDraft] = useState(savedAskShortcut);
  const [selectionDraft, setSelectionDraft] = useState(savedSelectionShortcut);
  const [isSaving, setIsSaving] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [askFormatError, setAskFormatError] = useState(false);
  const [selectionFormatError, setSelectionFormatError] = useState(false);

  useEffect(() => {
    setAskDraft(savedAskShortcut);
  }, [savedAskShortcut]);

  useEffect(() => {
    setSelectionDraft(savedSelectionShortcut);
  }, [savedSelectionShortcut]);

  useEffect(() => {
    if (!window.electronAPI?.on) {
      return;
    }
    return window.electronAPI.on((event) => {
      if (event.type === 'quickAsk.status') {
        setAskError(event.payload.error);
        setSelectionError(event.payload.selectionError);
      }
    });
  }, []);

  const persist = useCallback(
    async (next: {
      quickAskEnabled?: boolean;
      quickAskShortcut?: string;
      quickAskSelectionShortcut?: string;
    }) => {
      if (!isElectron || !window.electronAPI?.config?.save) {
        return;
      }
      setIsSaving(true);
      setAskFormatError(false);
      setSelectionFormatError(false);
      try {
        const result = await window.electronAPI.config.save(next);
        if (result?.config) {
          setAppConfig(result.config);
        }
        const askRegError =
          'quickAskShortcutError' in result
            ? ((result as { quickAskShortcutError?: string | null }).quickAskShortcutError ??
              null)
            : null;
        const selectionRegError =
          'quickAskSelectionShortcutError' in result
            ? ((result as { quickAskSelectionShortcutError?: string | null })
                .quickAskSelectionShortcutError ?? null)
            : null;
        setAskError(askRegError);
        setSelectionError(selectionRegError);
      } catch {
        // Keep previous values; config.status may still sync later.
      } finally {
        setIsSaving(false);
      }
    },
    [setAppConfig]
  );

  const handleToggle = useCallback(() => {
    if (isSaving) {
      return;
    }
    void persist({ quickAskEnabled: !enabled });
  }, [enabled, isSaving, persist]);

  const handleShortcutBlur = useCallback(
    (field: ShortcutField) => {
      if (field === 'ask') {
        const normalized = normalizeQuickAskShortcut(askDraft);
        if (!normalized) {
          setAskFormatError(true);
          setAskDraft(savedAskShortcut);
          return;
        }
        setAskFormatError(false);
        if (normalized === savedAskShortcut) {
          return;
        }
        void persist({ quickAskShortcut: normalized });
        return;
      }

      const normalized = normalizeQuickAskShortcut(selectionDraft);
      if (!normalized) {
        setSelectionFormatError(true);
        setSelectionDraft(savedSelectionShortcut);
        return;
      }
      setSelectionFormatError(false);
      if (normalized === savedSelectionShortcut) {
        return;
      }
      void persist({ quickAskSelectionShortcut: normalized });
    },
    [askDraft, persist, savedAskShortcut, savedSelectionShortcut, selectionDraft]
  );

  const askErrorMessage =
    askError === 'shortcut_taken'
      ? t('quickAsk.shortcutTaken')
      : askError
        ? t('quickAsk.shortcutRegisterFailed')
        : null;

  const selectionErrorMessage =
    selectionError === 'shortcut_taken'
      ? t('quickAsk.shortcutTaken')
      : selectionError
        ? t('quickAsk.shortcutRegisterFailed')
        : null;

  return (
    <section className="rounded-lg border border-border-subtle bg-background px-4 py-4 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-text-primary">{t('quickAsk.settingsTitle')}</h4>
          <p className="mt-1 text-xs leading-5 text-text-muted">{t('quickAsk.settingsDesc')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={handleToggle}
          disabled={isSaving}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50 flex-shrink-0 ${
            enabled ? 'bg-accent' : 'bg-surface-muted'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-text-primary transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="quick-ask-shortcut"
          className="block text-xs font-medium text-text-secondary"
        >
          {t('quickAsk.shortcutLabel')}
        </label>
        <input
          id="quick-ask-shortcut"
          type="text"
          value={askDraft}
          disabled={!enabled || isSaving}
          onChange={(event) => {
            setAskDraft(event.target.value);
            setAskFormatError(
              event.target.value.trim().length > 0 && !isValidQuickAskShortcut(event.target.value)
            );
          }}
          onBlur={() => handleShortcutBlur('ask')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
          spellCheck={false}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder={DEFAULT_QUICK_ASK_SHORTCUT}
        />
        <p className="text-xs text-text-muted">{t('quickAsk.shortcutHint')}</p>
        {askFormatError && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{t('quickAsk.shortcutInvalid')}</p>
        )}
        {askErrorMessage && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{askErrorMessage}</p>
        )}
      </div>

      <div className="space-y-2">
        <label
          htmlFor="quick-ask-selection-shortcut"
          className="block text-xs font-medium text-text-secondary"
        >
          {t('quickAsk.selectionShortcutLabel')}
        </label>
        <input
          id="quick-ask-selection-shortcut"
          type="text"
          value={selectionDraft}
          disabled={!enabled || isSaving}
          onChange={(event) => {
            setSelectionDraft(event.target.value);
            setSelectionFormatError(
              event.target.value.trim().length > 0 && !isValidQuickAskShortcut(event.target.value)
            );
          }}
          onBlur={() => handleShortcutBlur('selection')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
          spellCheck={false}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder={DEFAULT_QUICK_ASK_SELECTION_SHORTCUT}
        />
        <p className="text-xs text-text-muted">{t('quickAsk.selectionShortcutHint')}</p>
        {selectionFormatError && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{t('quickAsk.shortcutInvalid')}</p>
        )}
        {selectionErrorMessage && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{selectionErrorMessage}</p>
        )}
      </div>
    </section>
  );
}
