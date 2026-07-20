import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUICK_ASK_SELECTION_SHORTCUT,
  DEFAULT_QUICK_ASK_SHORTCUT,
  isValidQuickAskShortcut,
  normalizeQuickAskShortcut,
} from '../../shared/quick-ask';

describe('normalizeQuickAskShortcut / isValidQuickAskShortcut', () => {
  it('accepts the default Ask and Sélection shortcuts', () => {
    expect(normalizeQuickAskShortcut(DEFAULT_QUICK_ASK_SHORTCUT)).toBe(
      DEFAULT_QUICK_ASK_SHORTCUT
    );
    expect(isValidQuickAskShortcut(DEFAULT_QUICK_ASK_SHORTCUT)).toBe(true);
    expect(normalizeQuickAskShortcut(DEFAULT_QUICK_ASK_SELECTION_SHORTCUT)).toBe(
      DEFAULT_QUICK_ASK_SELECTION_SHORTCUT
    );
    expect(isValidQuickAskShortcut(DEFAULT_QUICK_ASK_SELECTION_SHORTCUT)).toBe(true);
  });

  it('accepts common Electron accelerators', () => {
    expect(normalizeQuickAskShortcut('CommandOrControl+Shift+K')).toBe(
      'CommandOrControl+Shift+K'
    );
    expect(normalizeQuickAskShortcut('Ctrl+Alt+F12')).toBe('Ctrl+Alt+F12');
    expect(normalizeQuickAskShortcut('CmdOrCtrl+Space')).toBe('CmdOrCtrl+Space');
  });

  it('rejects empty, single-key, or malformed values', () => {
    expect(normalizeQuickAskShortcut('')).toBeNull();
    expect(normalizeQuickAskShortcut('   ')).toBeNull();
    expect(normalizeQuickAskShortcut('Space')).toBeNull();
    expect(normalizeQuickAskShortcut('CommandOrControl+')).toBeNull();
    expect(normalizeQuickAskShortcut('CommandOrControl+Shift+')).toBeNull();
    expect(normalizeQuickAskShortcut('Foo+Space')).toBeNull();
    expect(normalizeQuickAskShortcut(null)).toBeNull();
    expect(normalizeQuickAskShortcut(42)).toBeNull();
  });

  it('rejects duplicate modifiers', () => {
    expect(normalizeQuickAskShortcut('Control+Ctrl+A')).toBeNull();
    expect(normalizeQuickAskShortcut('CommandOrControl+CmdOrCtrl+A')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeQuickAskShortcut('  CommandOrControl+Shift+Space  ')).toBe(
      'CommandOrControl+Shift+Space'
    );
  });
});
