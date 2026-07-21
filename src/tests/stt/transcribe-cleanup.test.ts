import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';

const userDataRoot = path.join(os.tmpdir(), 'lygodactylus-stt-transcribe-test');

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getAppPath: () => process.cwd(),
    getPath: (name: string) => {
      if (name === 'userData') return userDataRoot;
      return path.join(userDataRoot, name);
    },
  },
  systemPreferences: {
    getMediaAccessStatus: () => 'granted',
    askForMediaAccess: async () => true,
  },
}));

vi.mock('../../main/i18n', () => ({
  mt: (key: string) => key,
}));

const spawnMock = vi.fn();

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args),
  };
});

function makeFakeChild(exitCode: number, stdout = 'hello world\n') {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    killed: boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    queueMicrotask(() => child.emit('close', exitCode === 0 ? 1 : exitCode));
  });
  queueMicrotask(() => {
    child.stdout.emit('data', Buffer.from(stdout));
    child.emit('close', exitCode);
  });
  return child;
}

describe('transcribeWav temp cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    spawnMock.mockReset();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
    fs.mkdirSync(userDataRoot, { recursive: true });

    const runtimeRoot = path.join(userDataRoot, 'runtimes', 'stt', '1.9.1');
    const modelsRoot = path.join(userDataRoot, 'runtimes', 'stt', 'models');
    fs.mkdirSync(path.join(runtimeRoot, 'bin'), { recursive: true });
    fs.mkdirSync(modelsRoot, { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, 'bin', 'whisper-cli'), '#!/bin/sh\n');
    fs.chmodSync(path.join(runtimeRoot, 'bin', 'whisper-cli'), 0o755);
    // Size must match pinned base model for isModelPresent — write exact size is huge,
    // so we stub ensureSttReady instead via vi.doMock after resetModules in each test.
  });

  afterEach(() => {
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  });

  async function loadWithReadyStub() {
    vi.doMock('../../main/runtime/stt-runtime', async () => {
      const actual = await vi.importActual<typeof import('../../main/runtime/stt-runtime')>(
        '../../main/runtime/stt-runtime'
      );
      return {
        ...actual,
        ensureSttReady: vi.fn(async () => ({
          binaryPath: path.join(userDataRoot, 'runtimes', 'stt', '1.9.1', 'bin', 'whisper-cli'),
          modelPath: path.join(userDataRoot, 'runtimes', 'stt', 'models', 'ggml-base.bin'),
          libDir: path.join(userDataRoot, 'runtimes', 'stt', '1.9.1', 'bin'),
        })),
        getSttTmpRoot: () => path.join(userDataRoot, 'runtimes', 'stt', 'tmp'),
      };
    });
    return import('../../main/stt/transcribe');
  }

  it('removes temp WAV after successful transcription', async () => {
    spawnMock.mockImplementation(() => makeFakeChild(0, 'bonjour\n'));
    const { transcribeWav } = await loadWithReadyStub();
    const tmpRoot = path.join(userDataRoot, 'runtimes', 'stt', 'tmp');

    const result = await transcribeWav({
      wav: Buffer.from('RIFF'),
      languageMode: 'ui',
      uiLanguage: 'fr',
    });

    expect(result.text).toContain('bonjour');
    expect(spawnMock).toHaveBeenCalled();
    const args = spawnMock.mock.calls[0]?.[1] as string[];
    expect(Array.isArray(args)).toBe(true);
    expect(args).not.toContain(expect.stringMatching(/;/)); // no shell concat
    // tmp dir empty (file deleted)
    if (fs.existsSync(tmpRoot)) {
      expect(fs.readdirSync(tmpRoot)).toEqual([]);
    }
  });

  it('removes temp WAV after whisper failure', async () => {
    spawnMock.mockImplementation(() => makeFakeChild(2, '', ));
    // override makeFakeChild for stderr-only failure
    spawnMock.mockImplementation(() => {
      const child = makeFakeChild(2, '');
      return child;
    });
    const { transcribeWav } = await loadWithReadyStub();
    const tmpRoot = path.join(userDataRoot, 'runtimes', 'stt', 'tmp');

    await expect(
      transcribeWav({ wav: Buffer.from('RIFF'), languageMode: 'auto' })
    ).rejects.toThrow(/errSttTranscribeFailed/);

    if (fs.existsSync(tmpRoot)) {
      expect(fs.readdirSync(tmpRoot)).toEqual([]);
    }
  });

  it('removes temp WAV on cancellation', async () => {
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
        killed: boolean;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.killed = false;
      child.kill = vi.fn(() => {
        child.killed = true;
        queueMicrotask(() => child.emit('close', 1));
      });
      // never closes until kill
      return child;
    });

    const { transcribeWav } = await loadWithReadyStub();
    const tmpRoot = path.join(userDataRoot, 'runtimes', 'stt', 'tmp');
    const controller = new AbortController();

    const promise = transcribeWav({
      wav: Buffer.from('RIFF'),
      signal: controller.signal,
    });
    // Allow spawn + file write
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();

    await expect(promise).rejects.toThrow(/errSttCancelled/);
    await new Promise((r) => setTimeout(r, 20));
    if (fs.existsSync(tmpRoot)) {
      expect(fs.readdirSync(tmpRoot)).toEqual([]);
    }
  });
});
