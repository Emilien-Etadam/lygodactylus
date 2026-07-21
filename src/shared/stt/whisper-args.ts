/**
 * Build whisper-cli argv as a strict args array (never shell-interpolated).
 * Paths may contain spaces — spawn receives them as discrete argv entries.
 */

export interface BuildWhisperArgsInput {
  modelPath: string;
  wavPath: string;
  language: string;
}

/**
 * Exact CLI contract for local STT v1.
 * `--no-prints` keeps STDOUT limited to the transcript (no banner/noise).
 */
export function buildWhisperArgs(input: BuildWhisperArgsInput): string[] {
  const { modelPath, wavPath, language } = input;
  if (!modelPath || !wavPath || !language) {
    throw new Error('modelPath, wavPath and language are required');
  }
  return [
    '-m',
    modelPath,
    '-f',
    wavPath,
    '-l',
    language,
    '--no-timestamps',
    '--no-prints',
  ];
}

export interface WhisperSpawnEnvInput {
  platform: NodeJS.Platform | string;
  /** Directory containing the binary (and DLLs / .so on win/linux). */
  binaryDir: string;
  /** macOS bottle lib directory (dylibs). Ignored on other platforms. */
  libDir?: string;
  baseEnv?: NodeJS.ProcessEnv;
}

/**
 * Environment + cwd for spawning whisper-cli so dynamic libs resolve.
 * Binary is never moved out of its extraction folder.
 */
export function buildWhisperSpawnOptions(input: WhisperSpawnEnvInput): {
  cwd: string;
  env: NodeJS.ProcessEnv;
} {
  const base = { ...(input.baseEnv ?? process.env) };
  const cwd = input.binaryDir;

  if (input.platform === 'linux') {
    const existing = base.LD_LIBRARY_PATH || '';
    base.LD_LIBRARY_PATH = existing
      ? `${input.binaryDir}${pathListSep(input.platform)}${existing}`
      : input.binaryDir;
  }

  if (input.platform === 'darwin') {
    const libDir = input.libDir || input.binaryDir;
    const sep = pathListSep(input.platform);
    const existing = base.DYLD_LIBRARY_PATH || '';
    const existingFallback = base.DYLD_FALLBACK_LIBRARY_PATH || '';
    base.DYLD_LIBRARY_PATH = existing ? `${libDir}${sep}${existing}` : libDir;
    base.DYLD_FALLBACK_LIBRARY_PATH = existingFallback
      ? `${libDir}${sep}${existingFallback}`
      : libDir;
  }

  // Windows: cwd = binary dir → DLL resolution is implicit.
  return { cwd, env: base };
}

function pathListSep(platform: string): string {
  return platform === 'win32' ? ';' : ':';
}
