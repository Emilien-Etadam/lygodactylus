/**
 * Shared whisper.cpp STT runtime download/extract utilities (v1.9.1).
 *
 * Sources (voie A — pinned, no floating formula resolution at runtime):
 * - win-x64 / linux-x64: official ggml-org/whisper.cpp release assets
 * - macOS arm64 / x64: Homebrew whisper-cpp 1.9.1 bottles via ghcr.io digest URLs
 *
 * Models: Hugging Face ggerganov/whisper.cpp pinned by commit SHA.
 */
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

export const WHISPER_VERSION = '1.9.1';
export const WHISPER_TAG = `v${WHISPER_VERSION}`;

/** Hugging Face commit that hosts the ggml model files we pin. */
export const HF_MODEL_COMMIT = '5359861c739e955e79d9a303bcbc70fb988958b1';

const GH_RELEASE_BASE = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}`;

/**
 * Pinned binary archives. sha256 is of the downloaded archive bytes.
 * macOS bottles use the ghcr blob digest as both URL pin and checksum.
 */
export const BINARY_ASSETS = {
  'win32-x64': {
    url: `${GH_RELEASE_BASE}/whisper-bin-x64.zip`,
    sha256: '7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539',
    bytes: 7_982_101,
    kind: 'zip',
  },
  'linux-x64': {
    url: `${GH_RELEASE_BASE}/whisper-bin-ubuntu-x64.tar.gz`,
    sha256: 'f3bf3b4369a99b54665b0f19b88483b30de27f25963b0414235dea03198515c5',
    bytes: 9_379_235,
    kind: 'tar.gz',
  },
  // Homebrew whisper-cpp 1.9.1 arm64_sonoma bottle (digest URL — immutable).
  'darwin-arm64': {
    url: 'https://ghcr.io/v2/homebrew/core/whisper-cpp/blobs/sha256:046321f0a5cd3efd9d341a20c054bb4f9843afb3cb6ff2112a6d009b0217f256',
    sha256: '046321f0a5cd3efd9d341a20c054bb4f9843afb3cb6ff2112a6d009b0217f256',
    bytes: 3_271_001,
    kind: 'bottle',
    // Fallback (commented intent only — NOT used at runtime):
    // formulae.brew.sh/api/formula/whisper-cpp.json → bottles.stable.files.arm64_sonoma
  },
  // Homebrew whisper-cpp 1.9.1 sonoma (x86_64) bottle.
  'darwin-x64': {
    url: 'https://ghcr.io/v2/homebrew/core/whisper-cpp/blobs/sha256:883b32e649643d9940104a4621db35c0bf6747e7aa8832183e7c29204bb33c28',
    sha256: '883b32e649643d9940104a4621db35c0bf6747e7aa8832183e7c29204bb33c28',
    bytes: 3_472_150,
    kind: 'bottle',
  },
};

export const MODEL_ASSETS = {
  base: {
    id: 'base',
    filename: 'ggml-base.bin',
    url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${HF_MODEL_COMMIT}/ggml-base.bin`,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    bytes: 147_951_465,
  },
  small: {
    id: 'small',
    filename: 'ggml-small.bin',
    url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${HF_MODEL_COMMIT}/ggml-small.bin`,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    bytes: 487_601_967,
  },
};

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function rmrf(target) {
  if (exists(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

export function platformKey(platform = process.platform, arch = process.arch) {
  const normalizedArch = arch === 'arm64' ? 'arm64' : 'x64';
  if (platform === 'win32') return `win32-${normalizedArch}`;
  if (platform === 'linux') return `linux-${normalizedArch}`;
  if (platform === 'darwin') return `darwin-${normalizedArch}`;
  return null;
}

export function getBinaryAsset(platform = process.platform, arch = process.arch) {
  const key = platformKey(platform, arch);
  if (!key || !BINARY_ASSETS[key]) {
    throw new Error(`Unsupported STT platform: ${platform}-${arch}`);
  }
  return { key, ...BINARY_ASSETS[key] };
}

export function getModelAsset(modelId = 'base') {
  const asset = MODEL_ASSETS[modelId];
  if (!asset) {
    throw new Error(`Unknown STT model: ${modelId}`);
  }
  return asset;
}

export function resolveBinaryPath(runtimeRoot, platform = process.platform) {
  const name = platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const candidate = path.join(runtimeRoot, 'bin', name);
  return exists(candidate) ? candidate : null;
}

export function resolveLibDir(runtimeRoot, platform = process.platform) {
  if (platform === 'darwin') {
    const libDir = path.join(runtimeRoot, 'lib');
    return exists(libDir) ? libDir : null;
  }
  // win/linux: libs sit next to the binary
  const binDir = path.join(runtimeRoot, 'bin');
  return exists(binDir) ? binDir : null;
}

export function isBinaryRuntimeComplete(runtimeRoot, platform = process.platform) {
  return resolveBinaryPath(runtimeRoot, platform) !== null;
}

export function isModelPresent(modelsRoot, modelId = 'base') {
  const asset = getModelAsset(modelId);
  const filePath = path.join(modelsRoot, asset.filename);
  if (!exists(filePath)) return false;
  try {
    const stat = fs.statSync(filePath);
    return stat.size === asset.bytes;
  } catch {
    return false;
  }
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * Verify archive/model sha256. On mismatch, delete the file and throw.
 */
export function verifySha256OrDelete(filePath, expectedSha256) {
  const actual = sha256File(filePath);
  if (actual !== expectedSha256) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
    throw new Error(
      `Checksum mismatch for ${path.basename(filePath)}: expected ${expectedSha256}, got ${actual}`
    );
  }
  return actual;
}

/**
 * Download URL into `${finalDest}.part` (never publishes finalDest).
 * Caller must verify checksum then atomically rename.
 */
function downloadToPart(url, finalDest, { headers = {}, onProgress, signal, redirectsLeft = 8 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Download cancelled'), { code: 'ABORT_ERR' }));
      return;
    }

    ensureDir(path.dirname(finalDest));
    const partPath = `${finalDest}.part`;
    rmrf(partPath);

    const transport = url.startsWith('http://') ? http : https;
    const req = transport.get(
      url,
      {
        headers: {
          'User-Agent': 'lygodactylus-stt-runtime',
          ...headers,
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.resume();
          const location = res.headers.location;
          if (!location || redirectsLeft <= 0) {
            reject(new Error(`Too many redirects downloading ${url}`));
            return;
          }
          const nextUrl = new URL(location, url).toString();
          downloadToPart(nextUrl, finalDest, {
            headers,
            onProgress,
            signal,
            redirectsLeft: redirectsLeft - 1,
          })
            .then(resolve)
            .catch(reject);
          return;
        }

        if (status !== 200) {
          res.resume();
          reject(new Error(`Failed to download ${url}: HTTP ${status}`));
          return;
        }

        const total = Number(res.headers['content-length']) || 0;
        let received = 0;
        const file = createWriteStream(partPath);

        const onAbort = () => {
          req.destroy();
          res.destroy();
          file.destroy();
          rmrf(partPath);
          reject(Object.assign(new Error('Download cancelled'), { code: 'ABORT_ERR' }));
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        res.on('data', (chunk) => {
          received += chunk.length;
          if (typeof onProgress === 'function') {
            onProgress({
              phase: 'download',
              bytesReceived: received,
              bytesTotal: total || undefined,
              percent: total ? Math.min(99, Math.round((received / total) * 100)) : undefined,
            });
          }
        });

        pipeline(res, file)
          .then(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve({ bytes: received, partPath });
          })
          .catch((err) => {
            signal?.removeEventListener('abort', onAbort);
            rmrf(partPath);
            reject(err);
          });
      }
    );

    req.on('error', (err) => {
      rmrf(`${finalDest}.part`);
      reject(err);
    });

    signal?.addEventListener(
      'abort',
      () => {
        req.destroy();
      },
      { once: true }
    );
  });
}

async function downloadVerifyPublish(url, finalDest, { headers, sha256, onProgress, signal }) {
  rmrf(finalDest);
  const { partPath } = await downloadToPart(url, finalDest, { headers, onProgress, signal });
  if (typeof onProgress === 'function') {
    onProgress({ phase: 'verify', percent: 99 });
  }
  verifySha256OrDelete(partPath, sha256);
  fs.renameSync(partPath, finalDest);
  return finalDest;
}

function extractZip(archivePath, destDir) {
  ensureDir(destDir);
  if (process.platform === 'win32') {
    // LiteralPath avoids wildcard injection; paths come from our controlled download dir.
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Expand-Archive -LiteralPath $env:STT_ZIP -DestinationPath $env:STT_DEST -Force',
      ],
      {
        stdio: 'pipe',
        env: { ...process.env, STT_ZIP: archivePath, STT_DEST: destDir },
      }
    );
    return;
  }
  execFileSync('unzip', ['-o', '-q', archivePath, '-d', destDir], { stdio: 'pipe' });
}

function extractTarGz(archivePath, destDir) {
  ensureDir(destDir);
  execFileSync('tar', ['-xzf', archivePath, '-C', destDir], { stdio: 'pipe' });
}

function copyFileExecutable(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  if (process.platform !== 'win32') {
    fs.chmodSync(dest, 0o755);
  }
}

function collectFilesRecursive(root, predicate) {
  const out = [];
  if (!exists(root)) return out;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (!predicate || predicate(full, entry.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

function installFromWindowsZip(extractRoot, runtimeRoot) {
  const binDir = path.join(runtimeRoot, 'bin');
  ensureDir(binDir);
  const releaseDir = path.join(extractRoot, 'Release');
  const searchRoot = exists(releaseDir) ? releaseDir : extractRoot;
  const files = collectFilesRecursive(searchRoot, (_full, name) => {
    const lower = name.toLowerCase();
    return lower === 'whisper-cli.exe' || lower.endsWith('.dll');
  });
  const cli = files.find((f) => path.basename(f).toLowerCase() === 'whisper-cli.exe');
  if (!cli) {
    throw new Error('whisper-cli.exe missing from Windows archive');
  }
  for (const file of files) {
    copyFileExecutable(file, path.join(binDir, path.basename(file)));
  }
}

function installFromLinuxTar(extractRoot, runtimeRoot) {
  const binDir = path.join(runtimeRoot, 'bin');
  ensureDir(binDir);
  const files = collectFilesRecursive(extractRoot, (_full, name) => {
    return name === 'whisper-cli' || name.includes('.so');
  });
  const cli = files.find((f) => path.basename(f) === 'whisper-cli');
  if (!cli) {
    throw new Error('whisper-cli missing from Linux archive');
  }
  for (const file of files) {
    copyFileExecutable(file, path.join(binDir, path.basename(file)));
  }
}

function installFromMacBottle(extractRoot, runtimeRoot) {
  const binDir = path.join(runtimeRoot, 'bin');
  const libDir = path.join(runtimeRoot, 'lib');
  ensureDir(binDir);
  ensureDir(libDir);

  const cliMatches = collectFilesRecursive(extractRoot, (_full, name) => name === 'whisper-cli');
  const cli = cliMatches[0];
  if (!cli) {
    throw new Error('whisper-cli missing from macOS bottle');
  }
  copyFileExecutable(cli, path.join(binDir, 'whisper-cli'));

  // Only shared libs needed at runtime (skip cmake/pkgconfig noise).
  const dylibs = collectFilesRecursive(extractRoot, (_full, name) => {
    return (
      name.startsWith('libwhisper') ||
      name.startsWith('libparakeet') ||
      name.startsWith('libggml')
    );
  });
  for (const file of dylibs) {
    const dest = path.join(libDir, path.basename(file));
    // Preserve symlinks when possible
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(file);
      try {
        fs.symlinkSync(target, dest);
      } catch {
        copyFileExecutable(file, dest);
      }
    } else {
      copyFileExecutable(file, dest);
    }
  }
}

/**
 * Download + verify + install the whisper-cli runtime for one platform.
 * Interrupted downloads restart from zero (no resume).
 */
export async function ensureSttBinary({
  runtimeRoot,
  platform = process.platform,
  arch = process.arch,
  onProgress,
  signal,
} = {}) {
  if (isBinaryRuntimeComplete(runtimeRoot, platform)) {
    return resolveBinaryPath(runtimeRoot, platform);
  }

  const asset = getBinaryAsset(platform, arch);
  const staging = `${runtimeRoot}.staging`;
  const archivePath = path.join(staging, `whisper-${asset.key}.${asset.kind === 'zip' ? 'zip' : 'tar.gz'}`);
  const extractDir = path.join(staging, 'extract');

  rmrf(staging);
  ensureDir(extractDir);

  try {
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'download', percent: 0, label: 'binary' });
    }

    const headers =
      asset.kind === 'bottle'
        ? {
            Authorization: 'Bearer QQ==',
            Accept: 'application/vnd.oci.image.layer.v1.tar+gzip',
          }
        : { Accept: '*/*' };

    await downloadVerifyPublish(asset.url, archivePath, {
      headers,
      sha256: asset.sha256,
      onProgress: (p) => {
        if (typeof onProgress === 'function') {
          onProgress({ ...p, label: 'binary' });
        }
      },
      signal,
    });

    if (typeof onProgress === 'function') {
      onProgress({ phase: 'extract', percent: 99, label: 'binary' });
    }

    if (asset.kind === 'zip') {
      extractZip(archivePath, extractDir);
      rmrf(runtimeRoot);
      ensureDir(runtimeRoot);
      installFromWindowsZip(extractDir, runtimeRoot);
    } else if (platform === 'linux') {
      extractTarGz(archivePath, extractDir);
      rmrf(runtimeRoot);
      ensureDir(runtimeRoot);
      installFromLinuxTar(extractDir, runtimeRoot);
    } else {
      extractTarGz(archivePath, extractDir);
      rmrf(runtimeRoot);
      ensureDir(runtimeRoot);
      installFromMacBottle(extractDir, runtimeRoot);
    }

    if (!isBinaryRuntimeComplete(runtimeRoot, platform)) {
      throw new Error('STT binary installation completed but whisper-cli is missing');
    }

    if (typeof onProgress === 'function') {
      onProgress({ phase: 'done', percent: 100, label: 'binary' });
    }
    return resolveBinaryPath(runtimeRoot, platform);
  } catch (error) {
    rmrf(runtimeRoot);
    throw error;
  } finally {
    rmrf(staging);
  }
}

/**
 * Download a ggml model into modelsRoot with .part → atomic rename after checksum.
 */
export async function ensureSttModel({
  modelsRoot,
  modelId = 'base',
  onProgress,
  signal,
} = {}) {
  const asset = getModelAsset(modelId);
  ensureDir(modelsRoot);
  const dest = path.join(modelsRoot, asset.filename);

  if (isModelPresent(modelsRoot, modelId)) {
    // Re-verify cheaply by size; optional deep hash skipped for speed when size matches.
    return dest;
  }

  try {
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'download', percent: 0, label: asset.filename });
    }

    await downloadVerifyPublish(asset.url, dest, {
      headers: { Accept: 'application/octet-stream' },
      sha256: asset.sha256,
      onProgress: (p) => {
        if (typeof onProgress === 'function') {
          onProgress({ ...p, label: asset.filename });
        }
      },
      signal,
    });

    if (!isModelPresent(modelsRoot, modelId)) {
      throw new Error(`Model ${asset.filename} missing or unexpected size after download`);
    }

    if (typeof onProgress === 'function') {
      onProgress({ phase: 'done', percent: 100, label: asset.filename });
    }
    return dest;
  } catch (error) {
    rmrf(`${dest}.part`);
    rmrf(dest);
    throw error;
  }
}

export function removeSttRuntime(runtimeRoot, modelsRoot) {
  rmrf(runtimeRoot);
  if (modelsRoot) {
    rmrf(modelsRoot);
  }
}

export function estimateDownloadBytes({
  platform = process.platform,
  arch = process.arch,
  modelId = 'base',
  includeBinary = true,
  includeModel = true,
} = {}) {
  let total = 0;
  if (includeBinary) {
    total += getBinaryAsset(platform, arch).bytes;
  }
  if (includeModel) {
    total += getModelAsset(modelId).bytes;
  }
  return total;
}
