/**
 * @module main/runtime/stt-runtime
 *
 * Resolves and downloads the whisper.cpp STT runtime (binary + models).
 * Packaged + dev both store under userData/runtimes/stt/ (on-demand).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { log, logError } from '../utils/logger';

export const WHISPER_VERSION = '1.9.1';

export type SttModelId = 'base' | 'small';

export interface SttProgress {
  phase: 'download' | 'verify' | 'extract' | 'done' | 'error';
  percent?: number;
  bytesReceived?: number;
  bytesTotal?: number;
  label?: string;
}

export interface SttRuntimeStatus {
  version: string;
  binaryReady: boolean;
  binaryPath: string | null;
  libDir: string | null;
  modelsRoot: string;
  runtimeRoot: string;
  tmpRoot: string;
  models: {
    base: { ready: boolean; path: string; bytes: number };
    small: { ready: boolean; path: string; bytes: number };
  };
  downloadBytes: {
    binary: number;
    base: number;
    small: number;
  };
  platformSupported: boolean;
}

interface SttRuntimeLib {
  WHISPER_VERSION: string;
  ensureSttBinary: (options: {
    runtimeRoot: string;
    platform?: string;
    arch?: string;
    onProgress?: (p: SttProgress) => void;
    signal?: AbortSignal;
  }) => Promise<string>;
  ensureSttModel: (options: {
    modelsRoot: string;
    modelId?: string;
    onProgress?: (p: SttProgress) => void;
    signal?: AbortSignal;
  }) => Promise<string>;
  resolveBinaryPath: (runtimeRoot: string, platform?: string) => string | null;
  resolveLibDir: (runtimeRoot: string, platform?: string) => string | null;
  isBinaryRuntimeComplete: (runtimeRoot: string, platform?: string) => boolean;
  isModelPresent: (modelsRoot: string, modelId?: string) => boolean;
  getBinaryAsset: (platform?: string, arch?: string) => { bytes: number; sha256: string; url: string };
  getModelAsset: (modelId?: string) => { bytes: number; filename: string; sha256: string; url: string };
  removeSttRuntime: (runtimeRoot: string, modelsRoot?: string) => void;
  platformKey: (platform?: string, arch?: string) => string | null;
  verifySha256OrDelete: (filePath: string, expectedSha256: string) => string;
}

let cachedLib: SttRuntimeLib | null = null;
let ensureBinaryPromise: Promise<string> | null = null;
let activeAbort: AbortController | null = null;

async function loadSttRuntimeLib(): Promise<SttRuntimeLib> {
  if (cachedLib) return cachedLib;
  const libPath = path.join(app.getAppPath(), 'scripts', 'lib', 'stt-runtime.mjs');
  cachedLib = (await import(pathToFileURL(libPath).href)) as SttRuntimeLib;
  return cachedLib;
}

export function getSttRuntimeRoot(): string {
  return path.join(app.getPath('userData'), 'runtimes', 'stt', WHISPER_VERSION);
}

export function getSttModelsRoot(): string {
  return path.join(app.getPath('userData'), 'runtimes', 'stt', 'models');
}

export function getSttTmpRoot(): string {
  return path.join(app.getPath('userData'), 'runtimes', 'stt', 'tmp');
}

export function clearSttRuntimeCache(): void {
  ensureBinaryPromise = null;
}

export function isSttPlatformSupported(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): boolean {
  if (platform === 'win32' && arch === 'x64') return true;
  if (platform === 'linux' && arch === 'x64') return true;
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return true;
  return false;
}

export async function getSttRuntimeStatus(): Promise<SttRuntimeStatus> {
  const lib = await loadSttRuntimeLib();
  const runtimeRoot = getSttRuntimeRoot();
  const modelsRoot = getSttModelsRoot();
  const tmpRoot = getSttTmpRoot();
  const binaryPath = lib.resolveBinaryPath(runtimeRoot, process.platform);
  const baseAsset = lib.getModelAsset('base');
  const smallAsset = lib.getModelAsset('small');
  let binaryBytes = 0;
  try {
    binaryBytes = lib.getBinaryAsset(process.platform, process.arch).bytes;
  } catch {
    binaryBytes = 0;
  }

  return {
    version: WHISPER_VERSION,
    binaryReady: binaryPath !== null,
    binaryPath,
    libDir: lib.resolveLibDir(runtimeRoot, process.platform),
    modelsRoot,
    runtimeRoot,
    tmpRoot,
    models: {
      base: {
        ready: lib.isModelPresent(modelsRoot, 'base'),
        path: path.join(modelsRoot, baseAsset.filename),
        bytes: baseAsset.bytes,
      },
      small: {
        ready: lib.isModelPresent(modelsRoot, 'small'),
        path: path.join(modelsRoot, smallAsset.filename),
        bytes: smallAsset.bytes,
      },
    },
    downloadBytes: {
      binary: binaryBytes,
      base: baseAsset.bytes,
      small: smallAsset.bytes,
    },
    platformSupported: isSttPlatformSupported(),
  };
}

export function cancelSttDownload(): void {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
  ensureBinaryPromise = null;
}

export async function ensureSttBinaryRuntime(
  onProgress?: (progress: SttProgress) => void
): Promise<string> {
  if (!isSttPlatformSupported()) {
    throw new Error(`STT is not supported on ${process.platform}-${process.arch}`);
  }

  const lib = await loadSttRuntimeLib();
  const runtimeRoot = getSttRuntimeRoot();
  const existing = lib.resolveBinaryPath(runtimeRoot, process.platform);
  if (existing) {
    return existing;
  }

  if (!ensureBinaryPromise) {
    const controller = new AbortController();
    activeAbort = controller;
    ensureBinaryPromise = (async () => {
      log('[SttRuntime] Downloading whisper-cli on first use...');
      fs.mkdirSync(path.dirname(runtimeRoot), { recursive: true });
      const binaryPath = await lib.ensureSttBinary({
        runtimeRoot,
        platform: process.platform,
        arch: process.arch,
        onProgress,
        signal: controller.signal,
      });
      log(`[SttRuntime] Binary ready: ${binaryPath}`);
      return binaryPath;
    })()
      .catch((error) => {
        ensureBinaryPromise = null;
        const message = error instanceof Error ? error.message : String(error);
        logError('[SttRuntime] Failed to ensure binary:', message);
        throw error;
      })
      .finally(() => {
        if (activeAbort === controller) {
          activeAbort = null;
        }
      });
  }

  return ensureBinaryPromise;
}

export async function ensureSttModelRuntime(
  modelId: SttModelId = 'base',
  onProgress?: (progress: SttProgress) => void
): Promise<string> {
  const lib = await loadSttRuntimeLib();
  const modelsRoot = getSttModelsRoot();
  const controller = new AbortController();
  activeAbort = controller;
  try {
    return await lib.ensureSttModel({
      modelsRoot,
      modelId,
      onProgress,
      signal: controller.signal,
    });
  } finally {
    if (activeAbort === controller) {
      activeAbort = null;
    }
  }
}

export async function ensureSttReady(
  modelId: SttModelId = 'base',
  onProgress?: (progress: SttProgress) => void
): Promise<{ binaryPath: string; modelPath: string; libDir: string | null }> {
  const binaryPath = await ensureSttBinaryRuntime((p) => onProgress?.(p));
  const modelPath = await ensureSttModelRuntime(modelId, (p) => onProgress?.(p));
  const lib = await loadSttRuntimeLib();
  return {
    binaryPath,
    modelPath,
    libDir: lib.resolveLibDir(getSttRuntimeRoot(), process.platform),
  };
}

export async function removeSttRuntimeFiles(): Promise<void> {
  cancelSttDownload();
  const lib = await loadSttRuntimeLib();
  lib.removeSttRuntime(getSttRuntimeRoot(), getSttModelsRoot());
  // Also clear tmp
  const tmp = getSttTmpRoot();
  if (fs.existsSync(tmp)) {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  clearSttRuntimeCache();
  log('[SttRuntime] Removed STT runtime + models');
}

/** Test helper — path to the shared lib. */
export function getSttRuntimeLibPath(): string {
  return path.join(app.getAppPath(), 'scripts', 'lib', 'stt-runtime.mjs');
}
