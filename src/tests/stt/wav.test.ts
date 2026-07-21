import { describe, expect, it } from 'vitest';
import {
  encodeWavPcm16Mono,
  parseWavHeader,
  WAV_HEADER_BYTES,
  STT_SAMPLE_RATE,
} from '../../shared/stt/wav';

function sinePcm16(seconds: number, sampleRate: number, freq = 440): Int16Array {
  const n = Math.floor(seconds * sampleRate);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    out[i] = Math.round(Math.sin(2 * Math.PI * freq * t) * 0.5 * 0x7fff);
  }
  return out;
}

describe('encodeWavPcm16Mono', () => {
  it('writes an exact 44-byte RIFF/WAVE PCM header for 16 kHz mono', () => {
    const samples = sinePcm16(0.05, STT_SAMPLE_RATE);
    const buf = encodeWavPcm16Mono(samples, STT_SAMPLE_RATE);
    expect(buf.byteLength).toBe(WAV_HEADER_BYTES + samples.byteLength);

    const header = parseWavHeader(buf);
    expect(header.riff).toBe('RIFF');
    expect(header.wave).toBe('WAVE');
    expect(header.audioFormat).toBe(1);
    expect(header.channels).toBe(1);
    expect(header.sampleRate).toBe(16_000);
    expect(header.bitsPerSample).toBe(16);
    expect(header.blockAlign).toBe(2);
    expect(header.byteRate).toBe(32_000);
    expect(header.dataSize).toBe(samples.byteLength);

    const bytes = new Uint8Array(buf);
    expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe('fmt ');
    expect(String.fromCharCode(...bytes.subarray(36, 40))).toBe('data');
  });

  it('rejects invalid sample rates', () => {
    expect(() => encodeWavPcm16Mono(new Int16Array(4), 0)).toThrow(/sample rate/i);
  });
});
