import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Loader2, Mic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { formatBytes, startSttCapture, type SttCaptureSession } from '../../utils/stt-capture';

type MicUiState = 'idle' | 'recording' | 'transcribing' | 'downloading';

interface MicButtonProps {
  disabled?: boolean;
  onInsertText: (text: string) => void;
}

const PTT_HOLD_MS = 280;

export function MicButton({ disabled = false, onInsertText }: MicButtonProps) {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const enabled = appConfig?.speechToTextEnabled === true;

  const [uiState, setUiState] = useState<MicUiState>('idle');
  const [progressPercent, setProgressPercent] = useState<number | null>(null);

  const sessionRef = useRef<SttCaptureSession | null>(null);
  const uiStateRef = useRef<MicUiState>('idle');
  const pttTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedByPttRef = useRef(false);
  const suppressClickRef = useRef(false);
  const progressUnsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    uiStateRef.current = uiState;
  }, [uiState]);

  useEffect(() => {
    return () => {
      if (pttTimerRef.current) clearTimeout(pttTimerRef.current);
      sessionRef.current?.cancel();
      sessionRef.current = null;
      progressUnsubRef.current?.();
      void window.electronAPI?.stt?.cancelTranscribe?.();
    };
  }, []);

  const toast = useCallback(
    (message: string, type: 'info' | 'warning' | 'error' | 'success' = 'warning') => {
      setGlobalNotice({
        id: `stt-${Date.now()}`,
        type,
        message,
      });
    },
    [setGlobalNotice]
  );

  const subscribeProgress = useCallback(() => {
    progressUnsubRef.current?.();
    if (!window.electronAPI?.on) return;
    progressUnsubRef.current = window.electronAPI.on((event) => {
      if (event.type !== 'stt.progress') return;
      if (typeof event.payload.percent === 'number') {
        setProgressPercent(event.payload.percent);
      }
    });
  }, []);

  const ensureRuntime = useCallback(async (): Promise<boolean> => {
    if (!window.electronAPI?.stt) {
      toast(t('stt.unavailable'), 'error');
      return false;
    }

    const status = await window.electronAPI.stt.getStatus();
    if (!status.platformSupported) {
      toast(t('stt.unsupportedPlatform'), 'error');
      return false;
    }

    const modelId = appConfig?.speechToTextModel === 'small' ? 'small' : 'base';
    const modelReady = status.models[modelId]?.ready;
    if (status.binaryReady && modelReady) {
      return true;
    }

    const bytes =
      (status.binaryReady ? 0 : status.downloadBytes.binary) +
      (modelReady ? 0 : status.downloadBytes[modelId]);
    const ok = window.confirm(
      t('stt.downloadConfirm', {
        size: formatBytes(bytes),
        version: status.version,
      })
    );
    if (!ok) return false;

    setUiState('downloading');
    setProgressPercent(0);
    subscribeProgress();
    const result = await window.electronAPI.stt.ensure(modelId);
    progressUnsubRef.current?.();
    progressUnsubRef.current = null;
    setProgressPercent(null);
    setUiState('idle');

    if (!result.success) {
      if (!result.cancelled) {
        toast(result.error || t('stt.downloadFailed'), 'error');
      }
      return false;
    }
    toast(t('stt.downloadDone'), 'success');
    return true;
  }, [appConfig?.speechToTextModel, subscribeProgress, t, toast]);

  const finishRecording = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) return;

    setUiState('transcribing');
    try {
      const wav = await session.stop();
      const result = await window.electronAPI.stt.transcribe({
        wav,
        modelId: appConfig?.speechToTextModel === 'small' ? 'small' : 'base',
      });
      if (!result.success) {
        if (!result.cancelled) {
          toast(result.error || t('stt.transcribeFailed'), 'error');
        }
        return;
      }
      const text = (result.text || '').trim();
      if (!text) {
        toast(t('stt.emptyTranscript'), 'info');
        return;
      }
      onInsertText(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast(message || t('stt.transcribeFailed'), 'error');
    } finally {
      setUiState('idle');
      startedByPttRef.current = false;
    }
  }, [appConfig?.speechToTextModel, onInsertText, t, toast]);

  const beginRecording = useCallback(async (): Promise<boolean> => {
    if (!enabled || disabled || uiStateRef.current !== 'idle') return false;
    if (!window.electronAPI?.stt) {
      toast(t('stt.unavailable'), 'error');
      return false;
    }

    const ready = await ensureRuntime();
    if (!ready) return false;

    const permission = await window.electronAPI.stt.requestMicrophoneAccess();
    if (!permission.granted) {
      toast(t('stt.micDenied'), 'error');
      return false;
    }

    try {
      const session = await startSttCapture();
      sessionRef.current = session;
      setUiState('recording');
      return true;
    } catch {
      toast(t('stt.micDenied'), 'error');
      setUiState('idle');
      return false;
    }
  }, [disabled, enabled, ensureRuntime, t, toast]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!enabled || disabled) return;
      if (event.button !== 0) return;
      if (pttTimerRef.current) clearTimeout(pttTimerRef.current);
      // Hold → push-to-talk start (click toggle uses onClick instead).
      pttTimerRef.current = setTimeout(() => {
        void (async () => {
          const started = await beginRecording();
          if (started) {
            startedByPttRef.current = true;
          }
        })();
      }, PTT_HOLD_MS);
    },
    [beginRecording, disabled, enabled]
  );

  const handlePointerUp = useCallback(() => {
    if (pttTimerRef.current) {
      clearTimeout(pttTimerRef.current);
      pttTimerRef.current = null;
    }
    if (startedByPttRef.current && uiStateRef.current === 'recording') {
      suppressClickRef.current = true;
      void finishRecording();
    }
  }, [finishRecording]);

  const handleClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (!enabled || disabled) return;
    if (uiStateRef.current === 'recording') {
      void finishRecording();
      return;
    }
    if (uiStateRef.current === 'idle') {
      void beginRecording();
    }
  }, [beginRecording, disabled, enabled, finishRecording]);

  if (!enabled) {
    return null;
  }

  const title =
    uiState === 'recording'
      ? t('stt.recordingHint')
      : uiState === 'transcribing'
        ? t('stt.transcribing')
        : uiState === 'downloading'
          ? t('stt.downloading', { percent: progressPercent ?? 0 })
          : t('stt.idleHint');

  return (
    <button
      type="button"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      disabled={disabled || uiState === 'transcribing' || uiState === 'downloading'}
      title={title}
      aria-label={title}
      className={`relative w-9 h-9 rounded-2xl flex items-center justify-center transition-colors ${
        uiState === 'recording'
          ? 'bg-error/15 text-error animate-pulse'
          : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
      } disabled:opacity-50`}
    >
      {uiState === 'transcribing' || uiState === 'downloading' ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Mic className="w-4 h-4" />
      )}
    </button>
  );
}
