/**
 * Hand-rolled PCM16 mono WAV encoder/decoder helpers (44-byte header, no deps).
 */

export const WAV_HEADER_BYTES = 44;
export const STT_SAMPLE_RATE = 16_000;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Encode Int16 mono PCM samples into a standard RIFF/WAVE buffer.
 */
export function encodeWavPcm16Mono(
  samples: Int16Array,
  sampleRate: number = STT_SAMPLE_RATE
): ArrayBuffer {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error(`Invalid sample rate: ${sampleRate}`);
  }

  const dataBytes = samples.byteLength;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  // RIFF chunk
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');

  // fmt chunk
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono * 16-bit)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  // data chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  new Uint8Array(buffer, WAV_HEADER_BYTES).set(new Uint8Array(samples.buffer, samples.byteOffset, dataBytes));
  return buffer;
}

export interface WavHeaderInfo {
  riff: string;
  wave: string;
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataSize: number;
  byteRate: number;
  blockAlign: number;
}

/**
 * Parse and validate a 44-byte PCM WAV header.
 */
export function parseWavHeader(buffer: ArrayBuffer | Uint8Array): WavHeaderInfo {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < WAV_HEADER_BYTES) {
    throw new Error('WAV buffer too short for header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readAscii = (offset: number, len: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + len));

  const riff = readAscii(0, 4);
  const wave = readAscii(8, 4);
  const fmt = readAscii(12, 4);
  const data = readAscii(36, 4);

  if (riff !== 'RIFF' || wave !== 'WAVE' || fmt !== 'fmt ' || data !== 'data') {
    throw new Error('Invalid WAV header markers');
  }

  return {
    riff,
    wave,
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    dataSize: view.getUint32(40, true),
  };
}

/** Convert Float32 [-1,1] samples to Int16 PCM. */
export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}
