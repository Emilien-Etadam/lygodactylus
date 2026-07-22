import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
let resolveTranscribe: ((value: { text: string; language: string }) => void) | null = null;

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
  systemPreferences: {
    getMediaAccessStatus: () => 'granted',
    askForMediaAccess: async () => true,
  },
}));

vi.mock('../../main/main-renderer-bridge', () => ({
  sendToRenderer: vi.fn(),
}));

vi.mock('../../main/config/config-store', () => ({
  configStore: {
    getAll: () => ({
      speechToTextEnabled: true,
      speechToTextModel: 'base',
      speechToTextLanguage: 'ui',
      uiLanguage: 'fr',
    }),
  },
}));

vi.mock('../../main/runtime/stt-runtime', () => ({
  cancelSttDownload: vi.fn(),
  ensureSttReady: vi.fn(),
  getSttRuntimeStatus: vi.fn(),
  removeSttRuntimeFiles: vi.fn(),
}));

vi.mock('../../main/stt/transcribe', () => ({
  cancelActiveTranscription: vi.fn(),
  transcribeWav: vi.fn(
    () =>
      new Promise<{ text: string; language: string }>((resolve) => {
        resolveTranscribe = resolve;
      })
  ),
}));

vi.mock('../../main/i18n', () => ({
  mt: (key: string) => key,
}));

describe('ipc-stt busy guard', () => {
  beforeEach(async () => {
    handlers.clear();
    resolveTranscribe = null;
    vi.resetModules();
    const { registerSttIpc } = await import('../../main/ipc/ipc-stt');
    registerSttIpc();
  });

  afterEach(() => {
    resolveTranscribe?.({ text: 'done', language: 'fr' });
  });

  it('refuses stt.transcribe while a transcription is already active', async () => {
    const handler = handlers.get('stt.transcribe');
    expect(handler).toBeDefined();

    const payload = { wav: new Uint8Array([1, 2, 3]) };
    void handler!({}, payload);

    const busy = await handler!({}, payload);
    expect(busy).toEqual({ success: false, error: 'errSttBusy' });
  });
});
