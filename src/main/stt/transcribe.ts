/**
 * @module main/stt/transcribe
 *
 * Spawn whisper-cli on a temp WAV (userData scratch), return stdout text.
 * Temp file always deleted in finally (success / failure / cancel).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { buildWhisperArgs, buildWhisperSpawnOptions } from '../../shared/stt/whisper-args';
import { resolveWhisperLanguage, type SpeechToTextLanguageMode } from '../../shared/stt/language';
import {
  ensureSttReady,
  getSttTmpRoot,
  type SttModelId,
  type SttProgress,
} from '../runtime/stt-runtime';
import { log, logError, logWarn } from '../utils/logger';
import { mt } from '../i18n';

const TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000;

export interface TranscribeInput {
  /** WAV bytes (PCM16 mono 16 kHz). */
  wav: Buffer | Uint8Array;
  modelId?: SttModelId;
  languageMode?: SpeechToTextLanguageMode;
  uiLanguage?: string;
  onProgress?: (progress: SttProgress) => void;
  signal?: AbortSignal;
}

export interface TranscribeResult {
  text: string;
  language: string;
}

let activeChild: ChildProcess | null = null;

export function cancelActiveTranscription(): void {
  if (activeChild && !activeChild.killed) {
    try {
      activeChild.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  activeChild = null;
}

function ensureTmpDir(): string {
  const tmp = getSttTmpRoot();
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function cleanupFile(filePath: string | null): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    logWarn('[STT] Failed to remove temp WAV:', error);
  }
}

/**
 * Strip whisper noise; with --no-prints stdout should already be clean.
 */
export function extractTranscriptText(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line.startsWith('load_backend')) return false;
      if (line.startsWith('whisper_')) return false;
      if (line.startsWith('system_info')) return false;
      if (line.startsWith('main:')) return false;
      return true;
    });
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

export async function transcribeWav(input: TranscribeInput): Promise<TranscribeResult> {
  if (input.signal?.aborted) {
    throw Object.assign(new Error(mt('errSttCancelled')), { code: 'ABORT_ERR' });
  }

  const modelId = input.modelId ?? 'base';
  const language = resolveWhisperLanguage(input.languageMode ?? 'ui', input.uiLanguage);

  const { binaryPath, modelPath, libDir } = await ensureSttReady(modelId, input.onProgress);

  const tmpDir = ensureTmpDir();
  const wavPath = path.join(tmpDir, `stt-${randomUUID()}.wav`);
  let child: ChildProcess | null = null;

  try {
    fs.writeFileSync(wavPath, Buffer.from(input.wav));

    const args = buildWhisperArgs({
      modelPath,
      wavPath,
      language,
    });

    const binaryDir = path.dirname(binaryPath);
    const { cwd, env } = buildWhisperSpawnOptions({
      platform: process.platform,
      binaryDir,
      libDir: libDir ?? undefined,
      baseEnv: process.env,
    });

    log(`[STT] spawn ${path.basename(binaryPath)} lang=${language}`);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const text = await new Promise<string>((resolve, reject) => {
      const spawned = spawn(binaryPath, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child = spawned;
      activeChild = spawned;

      const onAbort = () => {
        try {
          spawned.kill('SIGTERM');
        } catch {
          // ignore
        }
        reject(Object.assign(new Error(mt('errSttCancelled')), { code: 'ABORT_ERR' }));
      };
      input.signal?.addEventListener('abort', onAbort, { once: true });

      const timer = setTimeout(() => {
        try {
          spawned.kill('SIGKILL');
        } catch {
          // ignore
        }
        reject(new Error(mt('errSttTimeout')));
      }, TRANSCRIBE_TIMEOUT_MS);

      spawned.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      spawned.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      spawned.on('error', (error) => {
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', onAbort);
        reject(error);
      });

      spawned.on('close', (code) => {
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', onAbort);
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        if (input.signal?.aborted) {
          reject(Object.assign(new Error(mt('errSttCancelled')), { code: 'ABORT_ERR' }));
          return;
        }
        if (code !== 0) {
          logError('[STT] whisper-cli failed:', stderr || stdout);
          reject(new Error(mt('errSttTranscribeFailed')));
          return;
        }
        resolve(extractTranscriptText(stdout));
      });
    });

    return { text, language };
  } finally {
    if (activeChild === child) {
      activeChild = null;
    }
    cleanupFile(wavPath);
  }
}
