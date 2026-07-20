import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function registerStoreMocks(userDataPath: string, machineKey: string): void {
  vi.doMock('electron', () => ({
    app: {
      getPath: (name: string) => {
        if (name !== 'userData') {
          throw new Error(`Unexpected path request: ${name}`);
        }
        return userDataPath;
      },
    },
  }));

  vi.doMock('../src/main/utils/machine-encryption-key', () => ({
    getMachineEncryptionKey: () => machineKey,
    LEGACY_STATIC_ENCRYPTION_KEYS: [],
  }));

  vi.doMock('electron-store', () => {
    class MockStore {
      public path: string;
      private internalStore: Record<string, unknown>;
      private readonly encryptionKey?: string;
      private readonly defaults: Record<string, unknown>;

      constructor(options: {
        name?: string;
        cwd?: string;
        defaults?: Record<string, unknown>;
        encryptionKey?: string;
      }) {
        const name = options.name || 'config';
        const baseDir = options.cwd ? path.resolve(options.cwd) : userDataPath;
        this.path = path.join(baseDir, `${name}.json`);
        this.defaults = { ...(options.defaults || {}) };
        this.encryptionKey = options.encryptionKey;

        if (fs.existsSync(this.path)) {
          const raw = fs.readFileSync(this.path, 'utf8');
          const parsed = JSON.parse(raw) as
            | Record<string, unknown>
            | { key?: string; payload?: Record<string, unknown> };

          if (this.encryptionKey) {
            const encrypted =
              parsed &&
              typeof parsed === 'object' &&
              'key' in parsed &&
              'payload' in parsed &&
              typeof parsed.payload === 'object';

            if (!encrypted) {
              throw new SyntaxError("Unexpected token '�', \"�...\" is not valid JSON");
            }

            if (parsed.key !== this.encryptionKey) {
              throw new SyntaxError("Unexpected token '�', \"�...\" is not valid JSON");
            }

            this.internalStore = {
              ...this.defaults,
              ...(parsed.payload || {}),
            };
            return;
          }

          this.internalStore = {
            ...this.defaults,
            ...(parsed as Record<string, unknown>),
          };
          return;
        }

        this.internalStore = { ...this.defaults };
      }

      get store(): Record<string, unknown> {
        return this.internalStore;
      }

      set store(value: Record<string, unknown>) {
        this.internalStore = value;
        if (this.encryptionKey) {
          fs.writeFileSync(
            this.path,
            JSON.stringify({
              key: this.encryptionKey,
              payload: value,
            })
          );
          return;
        }
        fs.writeFileSync(this.path, JSON.stringify(value));
      }

      get(key: string, defaultValue?: unknown): unknown {
        return this.internalStore[key] ?? defaultValue;
      }

      set(key: string, value: unknown): void {
        this.internalStore[key] = value;
        this.store = this.internalStore;
      }
    }

    return {
      default: MockStore,
    };
  });
}

describe('PromptPresetsStore CRUD', () => {
  let tempDir: string;
  let machineKey: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-presets-store-'));
    machineKey = crypto.randomBytes(32).toString('hex');
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('creates, lists, updates, finds by name, and deletes presets on disk', async () => {
    registerStoreMocks(tempDir, machineKey);
    const { PromptPresetsStore } = await import('../src/main/prompt-presets/prompt-presets-store');
    const store = new PromptPresetsStore();

    expect(store.list()).toEqual([]);

    const created = store.create({
      name: 'Revue',
      description: 'Code review',
      text: 'Review {{sujet}} in {{langue}} ({date})',
      systemPrompt: 'Be concise',
    });

    expect(created.id).toBeTruthy();
    expect(created.variables).toEqual(['sujet', 'langue']);
    expect(store.list()).toHaveLength(1);
    expect(store.get(created.id)?.name).toBe('Revue');
    expect(store.getByName('revue')?.id).toBe(created.id);

    const storePath = path.join(tempDir, 'prompt-presets.json');
    expect(fs.existsSync(storePath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(storePath, 'utf8')) as {
      key?: string;
      payload?: { presets: unknown[] };
    };
    expect(raw.key).toBe(machineKey);
    expect(raw.payload?.presets).toHaveLength(1);

    const updated = store.update(created.id, {
      name: 'Revue FR',
      text: 'Relis {{fichier}}',
      systemPrompt: null,
    });
    expect(updated?.name).toBe('Revue FR');
    expect(updated?.variables).toEqual(['fichier']);
    expect(updated?.systemPrompt).toBe('');
    expect(store.getByName('Revue FR')?.text).toBe('Relis {{fichier}}');

    expect(store.delete(created.id)).toBe(true);
    expect(store.list()).toEqual([]);
    expect(store.delete(created.id)).toBe(false);
  });

  it('rejects empty names', async () => {
    registerStoreMocks(tempDir, machineKey);
    const { PromptPresetsStore } = await import('../src/main/prompt-presets/prompt-presets-store');
    const store = new PromptPresetsStore();
    expect(() => store.create({ name: '   ', text: 'x' })).toThrow(/name/i);
  });
});
