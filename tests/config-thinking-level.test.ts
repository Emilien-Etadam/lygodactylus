import { describe, expect, it, vi } from 'vitest';

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-config-store-thinking.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = {
        ...(options?.defaults || {}),
      };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = {
        ...this.store,
        ...key,
      };
    }

    clear(): void {
      this.store = {};
    }
  }

  return {
    default: MockStore,
  };
});

import { ConfigStore } from '../src/main/config/config-store';
import { normalizeConfig } from '../src/main/config/config-normalizer';
import { isThinkingLevel } from '../src/main/config/config-schema';

describe('thinkingLevel config', () => {
  it('defaults to medium', () => {
    const store = new ConfigStore();
    expect(store.get('thinkingLevel')).toBe('medium');
    expect(store.getAll().thinkingLevel).toBe('medium');
  });

  it('persists updates through update()', () => {
    const store = new ConfigStore();
    store.update({ thinkingLevel: 'high' });
    expect(store.get('thinkingLevel')).toBe('high');
    expect(store.getAll().thinkingLevel).toBe('high');

    // Unrelated updates keep the stored level
    store.update({ enableThinking: true });
    expect(store.get('thinkingLevel')).toBe('high');
    expect(store.get('enableThinking')).toBe(true);
  });

  it('falls back to the default for invalid stored values', () => {
    const store = new ConfigStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.update({ thinkingLevel: 'turbo' as any });
    expect(store.get('thinkingLevel')).toBe('medium');
  });

  it('normalizes unknown raw values to the default', () => {
    expect(normalizeConfig({ thinkingLevel: 'low' }).thinkingLevel).toBe('low');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(normalizeConfig({ thinkingLevel: 'xhigh' as any }).thinkingLevel).toBe('medium');
    expect(normalizeConfig({}).thinkingLevel).toBe('medium');
  });

  it('exposes a strict type guard', () => {
    expect(isThinkingLevel('low')).toBe(true);
    expect(isThinkingLevel('medium')).toBe(true);
    expect(isThinkingLevel('high')).toBe(true);
    expect(isThinkingLevel('off')).toBe(false);
    expect(isThinkingLevel(undefined)).toBe(false);
    expect(isThinkingLevel(2)).toBe(false);
  });
});
