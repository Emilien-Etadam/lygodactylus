import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getRegisteredQuickAskAccelerator,
  registerQuickAskShortcut,
  resetQuickAskShortcutStateForTests,
  unregisterQuickAskShortcut,
  type GlobalShortcutApi,
} from '../../main/quick-ask/quick-ask-shortcut';

function createMockApi(options?: {
  registerResult?: boolean;
  throwOnRegister?: boolean;
}): GlobalShortcutApi & {
  register: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
  isRegistered: ReturnType<typeof vi.fn>;
} {
  const registered = new Set<string>();
  return {
    register: vi.fn((accelerator: string, _callback: () => void) => {
      if (options?.throwOnRegister) {
        throw new Error('register boom');
      }
      if (options?.registerResult === false) {
        return false;
      }
      registered.add(accelerator);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => {
      registered.delete(accelerator);
    }),
    isRegistered: vi.fn((accelerator: string) => registered.has(accelerator)),
  };
}

describe('registerQuickAskShortcut / unregisterQuickAskShortcut', () => {
  afterEach(() => {
    resetQuickAskShortcutStateForTests();
  });

  it('registers a shortcut and tracks the accelerator', () => {
    const api = createMockApi();
    const callback = vi.fn();
    const result = registerQuickAskShortcut('CommandOrControl+Shift+Space', callback, api);

    expect(result).toEqual({ ok: true, accelerator: 'CommandOrControl+Shift+Space' });
    expect(api.register).toHaveBeenCalledWith('CommandOrControl+Shift+Space', callback);
    expect(getRegisteredQuickAskAccelerator()).toBe('CommandOrControl+Shift+Space');
  });

  it('returns a handled failure when the OS rejects registration', () => {
    const api = createMockApi({ registerResult: false });
    const result = registerQuickAskShortcut('CommandOrControl+Shift+Space', vi.fn(), api);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('shortcut_taken');
    expect(getRegisteredQuickAskAccelerator()).toBeNull();
  });

  it('does not throw when register throws', () => {
    const api = createMockApi({ throwOnRegister: true });
    const result = registerQuickAskShortcut('CommandOrControl+Shift+A', vi.fn(), api);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('register boom');
    expect(getRegisteredQuickAskAccelerator()).toBeNull();
  });

  it('unregisters the previous accelerator when switching', () => {
    const api = createMockApi();
    registerQuickAskShortcut('CommandOrControl+Shift+Space', vi.fn(), api);
    registerQuickAskShortcut('CommandOrControl+Shift+A', vi.fn(), api);

    expect(api.unregister).toHaveBeenCalledWith('CommandOrControl+Shift+Space');
    expect(getRegisteredQuickAskAccelerator()).toBe('CommandOrControl+Shift+A');
  });

  it('unregisterQuickAskShortcut clears state safely', () => {
    const api = createMockApi();
    registerQuickAskShortcut('CommandOrControl+Shift+Space', vi.fn(), api);
    unregisterQuickAskShortcut(api);
    unregisterQuickAskShortcut(api); // second call is a no-op

    expect(api.unregister).toHaveBeenCalledTimes(1);
    expect(getRegisteredQuickAskAccelerator()).toBeNull();
  });
});
