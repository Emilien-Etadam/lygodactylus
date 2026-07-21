import { describe, expect, it } from 'vitest';
import { buildWhisperArgs, buildWhisperSpawnOptions } from '../../shared/stt/whisper-args';

describe('buildWhisperArgs', () => {
  it('builds a strict argv array with no shell interpolation', () => {
    const modelPath = '/Users/me/Library/Application Support/stt/models/ggml-base.bin';
    const wavPath = '/Users/me/Library/Application Support/stt/tmp/clip with spaces.wav';
    const args = buildWhisperArgs({
      modelPath,
      wavPath,
      language: 'fr',
    });

    expect(args).toEqual([
      '-m',
      modelPath,
      '-f',
      wavPath,
      '-l',
      'fr',
      '--no-timestamps',
      '--no-prints',
    ]);
    // Paths with spaces remain single argv entries (spawn-safe).
    expect(args[3]).toContain(' ');
    expect(args.every((a) => typeof a === 'string')).toBe(true);
    expect(args.join(' ')).not.toMatch(/\$\(|`/);
  });

  it('rejects missing fields', () => {
    expect(() =>
      buildWhisperArgs({ modelPath: '', wavPath: '/tmp/a.wav', language: 'en' })
    ).toThrow();
  });
});

describe('buildWhisperSpawnOptions', () => {
  it('sets cwd to binary dir on Windows (DLL resolution)', () => {
    const { cwd, env } = buildWhisperSpawnOptions({
      platform: 'win32',
      binaryDir: 'C:\\app\\stt\\bin',
      baseEnv: { PATH: 'C:\\Windows' },
    });
    expect(cwd).toBe('C:\\app\\stt\\bin');
    expect(env.PATH).toBe('C:\\Windows');
    expect(env.LD_LIBRARY_PATH).toBeUndefined();
  });

  it('prefixes LD_LIBRARY_PATH on Linux', () => {
    const { cwd, env } = buildWhisperSpawnOptions({
      platform: 'linux',
      binaryDir: '/opt/stt/bin',
      baseEnv: { LD_LIBRARY_PATH: '/usr/lib' },
    });
    expect(cwd).toBe('/opt/stt/bin');
    expect(env.LD_LIBRARY_PATH).toBe('/opt/stt/bin:/usr/lib');
  });

  it('sets DYLD_* paths on macOS to bottle lib dir', () => {
    const { cwd, env } = buildWhisperSpawnOptions({
      platform: 'darwin',
      binaryDir: '/Users/me/stt/bin',
      libDir: '/Users/me/stt/lib',
      baseEnv: {},
    });
    expect(cwd).toBe('/Users/me/stt/bin');
    expect(env.DYLD_LIBRARY_PATH).toBe('/Users/me/stt/lib');
    expect(env.DYLD_FALLBACK_LIBRARY_PATH).toBe('/Users/me/stt/lib');
  });
});
