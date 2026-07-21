/**
 * @module main/ipc/ipc-stt
 *
 * Named RPC channels for local speech-to-text (not on client-event allowlist).
 */
import { ipcMain, systemPreferences } from 'electron';
import { sendToRenderer } from '../main-renderer-bridge';
import { logError } from '../utils/logger';
import { mt } from '../i18n';
import { configStore } from '../config/config-store';
import {
  cancelSttDownload,
  ensureSttReady,
  getSttRuntimeStatus,
  removeSttRuntimeFiles,
  type SttModelId,
  type SttProgress,
} from '../runtime/stt-runtime';
import { cancelActiveTranscription, transcribeWav } from '../stt/transcribe';

let transcribeAbort: AbortController | null = null;

function emitProgress(progress: SttProgress): void {
  sendToRenderer({
    type: 'stt.progress',
    payload: progress,
  });
}

export function registerSttIpc(): void {
  ipcMain.handle('stt.getStatus', async () => {
    try {
      return await getSttRuntimeStatus();
    } catch (error) {
      logError('[STT] getStatus failed:', error);
      throw error;
    }
  });

  ipcMain.handle('stt.ensure', async (_event, modelId?: SttModelId) => {
    try {
      const config = configStore.getAll();
      const resolvedModel = (modelId || config.speechToTextModel || 'base') as SttModelId;
      const result = await ensureSttReady(resolvedModel, emitProgress);
      return {
        success: true,
        binaryPath: result.binaryPath,
        modelPath: result.modelPath,
        status: await getSttRuntimeStatus(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if ((error as { code?: string })?.code === 'ABORT_ERR') {
        return { success: false, cancelled: true, error: mt('errSttCancelled') };
      }
      logError('[STT] ensure failed:', message);
      return { success: false, error: message || mt('errSttDownloadFailed') };
    }
  });

  ipcMain.handle('stt.cancelDownload', async () => {
    cancelSttDownload();
    return { success: true };
  });

  ipcMain.handle('stt.remove', async () => {
    try {
      cancelActiveTranscription();
      cancelSttDownload();
      await removeSttRuntimeFiles();
      return { success: true, status: await getSttRuntimeStatus() };
    } catch (error) {
      logError('[STT] remove failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle(
    'stt.transcribe',
    async (
      _event,
      payload: {
        wav: ArrayBuffer | Uint8Array | Buffer;
        modelId?: SttModelId;
      }
    ) => {
      try {
        const config = configStore.getAll();
        if (!config.speechToTextEnabled) {
          return { success: false, error: mt('errSttDisabled') };
        }

        cancelActiveTranscription();
        transcribeAbort?.abort();
        transcribeAbort = new AbortController();

        const wavBytes =
          payload.wav instanceof ArrayBuffer
            ? new Uint8Array(payload.wav)
            : payload.wav instanceof Uint8Array
              ? payload.wav
              : new Uint8Array(payload.wav);

        const result = await transcribeWav({
          wav: wavBytes,
          modelId: (payload.modelId || config.speechToTextModel || 'base') as SttModelId,
          languageMode: config.speechToTextLanguage || 'ui',
          uiLanguage: config.uiLanguage,
          onProgress: emitProgress,
          signal: transcribeAbort.signal,
        });

        return { success: true, text: result.text, language: result.language };
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (code === 'ABORT_ERR') {
          return { success: false, cancelled: true, error: mt('errSttCancelled') };
        }
        const message = error instanceof Error ? error.message : String(error);
        logError('[STT] transcribe failed:', message);
        return { success: false, error: message || mt('errSttTranscribeFailed') };
      } finally {
        transcribeAbort = null;
      }
    }
  );

  ipcMain.handle('stt.cancelTranscribe', async () => {
    transcribeAbort?.abort();
    cancelActiveTranscription();
    return { success: true };
  });

  ipcMain.handle('stt.requestMicrophoneAccess', async () => {
    if (process.platform !== 'darwin') {
      return { granted: true, status: 'granted' as const };
    }
    try {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      if (status === 'granted') {
        return { granted: true, status };
      }
      const granted = await systemPreferences.askForMediaAccess('microphone');
      return {
        granted,
        status: systemPreferences.getMediaAccessStatus('microphone'),
      };
    } catch (error) {
      logError('[STT] microphone permission failed:', error);
      return { granted: false, status: 'denied' as const };
    }
  });
}
