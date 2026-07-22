import { describe, expect, it } from 'vitest';
import { downmixToMono, resampleLinear, toMono16kHz } from '../../shared/stt/resample';

describe('resample / downmix', () => {
  it('downmixes stereo to mono by averaging', () => {
    const stereo = new Float32Array([1, -1, 0.5, 0.5]);
    const mono = downmixToMono(stereo, 2);
    expect(Array.from(mono)).toEqual([0, 0.5]);
  });

  it('resamples 48 kHz mono to 16 kHz with expected length', () => {
    const input = new Float32Array(4800); // 100 ms at 48 kHz
    for (let i = 0; i < input.length; i += 1) {
      input[i] = Math.sin((2 * Math.PI * i) / 48);
    }
    const out = resampleLinear(input, 48_000, 16_000);
    expect(out.length).toBe(1600);
  });

  it('toMono16kHz combines downmix + resample', () => {
    const frames = 480;
    const stereo = new Float32Array(frames * 2);
    const out = toMono16kHz(stereo, 48_000, 2);
    expect(out.length).toBe(160);
  });
});
