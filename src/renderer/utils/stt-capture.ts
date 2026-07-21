/**
 * Microphone capture → mono 16 kHz PCM16 WAV (no MediaRecorder container deps).
 * Uses AudioContext + ScriptProcessor/AudioWorklet-free path via Offline-style
 * accumulation from an AudioWorklet-less ScriptProcessor fallback.
 */
import {
  encodeWavPcm16Mono,
  floatTo16BitPCM,
  STT_SAMPLE_RATE,
} from '../../shared/stt/wav';
import { toMono16kHz } from '../../shared/stt/resample';

export type SttCaptureState = 'idle' | 'recording' | 'transcribing';

export interface SttCaptureSession {
  stop: () => Promise<ArrayBuffer>;
  cancel: () => void;
}

/**
 * Start capturing microphone audio. Resolves a session whose `stop()` returns
 * a WAV ArrayBuffer ready for IPC transcription.
 */
export async function startSttCapture(): Promise<SttCaptureSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
    video: false,
  });

  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const chunks: Float32Array[] = [];
  let cancelled = false;

  // ScriptProcessor is deprecated but universally available in Electron/Chromium
  // and avoids shipping a worklet file. Buffer size 4096 ≈ 85–100 ms at 44.1/48k.
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => {
    if (cancelled) return;
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
  };

  // ScriptProcessor only runs when connected to the graph destination.
  // Mute so we never echo the microphone into speakers.
  const mute = audioContext.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioContext.destination);

  const cleanup = () => {
    try {
      processor.disconnect();
      source.disconnect();
    } catch {
      // ignore
    }
    for (const track of stream.getTracks()) {
      track.stop();
    }
    void audioContext.close();
  };

  return {
    cancel: () => {
      cancelled = true;
      cleanup();
    },
    stop: async () => {
      cancelled = true;
      const sampleRate = audioContext.sampleRate;
      cleanup();

      let total = 0;
      for (const chunk of chunks) total += chunk.length;
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      const mono16k = toMono16kHz(merged, sampleRate, 1);
      const pcm = floatTo16BitPCM(mono16k);
      return encodeWavPcm16Mono(pcm, STT_SAMPLE_RATE);
    },
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}
