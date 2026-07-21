/**
 * Lightweight linear resampler + downmix helpers for STT capture (no deps).
 */

/**
 * Downmix interleaved Float32 channels to mono.
 */
export function downmixToMono(input: Float32Array, channels: number): Float32Array {
  if (channels <= 1) {
    return input;
  }
  const frames = Math.floor(input.length / channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) {
      sum += input[i * channels + c] ?? 0;
    }
    out[i] = sum / channels;
  }
  return out;
}

/**
 * Linear-interpolate mono Float32 audio from `fromRate` to `toRate`.
 */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate <= 0 || toRate <= 0) {
    throw new Error(`Invalid sample rates: ${fromRate} → ${toRate}`);
  }
  if (fromRate === toRate || input.length === 0) {
    return input;
  }

  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);

  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = i * ratio;
    const left = Math.floor(srcIndex);
    const right = Math.min(left + 1, input.length - 1);
    const frac = srcIndex - left;
    const a = input[left] ?? 0;
    const b = input[right] ?? 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/**
 * Prepare capture buffer for whisper: mono + 16 kHz.
 */
export function toMono16kHz(
  input: Float32Array,
  sampleRate: number,
  channels: number = 1
): Float32Array {
  const mono = downmixToMono(input, channels);
  return resampleLinear(mono, sampleRate, 16_000);
}
