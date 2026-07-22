import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

async function loadLib() {
  const libPath = path.join(process.cwd(), 'scripts/lib/stt-runtime.mjs');
  return import(pathToFileURL(libPath).href);
}

describe('stt-runtime.mjs', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-runtime-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves binary path per platform layout', async () => {
    const lib = await loadLib();
    const winRoot = path.join(tmp, 'win');
    fs.mkdirSync(path.join(winRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(winRoot, 'bin', 'whisper-cli.exe'), '');
    expect(lib.resolveBinaryPath(winRoot, 'win32')).toMatch(/whisper-cli\.exe$/);
    expect(lib.resolveBinaryPath(winRoot, 'linux')).toBeNull();

    const linRoot = path.join(tmp, 'lin');
    fs.mkdirSync(path.join(linRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(linRoot, 'bin', 'whisper-cli'), '');
    expect(lib.resolveBinaryPath(linRoot, 'linux')).toMatch(/whisper-cli$/);

    const macRoot = path.join(tmp, 'mac');
    fs.mkdirSync(path.join(macRoot, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(macRoot, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(macRoot, 'bin', 'whisper-cli'), '');
    expect(lib.resolveBinaryPath(macRoot, 'darwin')).toMatch(/whisper-cli$/);
    expect(lib.resolveLibDir(macRoot, 'darwin')).toBe(path.join(macRoot, 'lib'));
  });

  it('deletes file and throws on checksum mismatch', async () => {
    const lib = await loadLib();
    const filePath = path.join(tmp, 'bad.bin');
    fs.writeFileSync(filePath, 'not-the-expected-bytes');
    const expected = createHash('sha256').update('something-else').digest('hex');

    expect(() => lib.verifySha256OrDelete(filePath, expected)).toThrow(/Checksum mismatch/);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('accepts matching checksum', async () => {
    const lib = await loadLib();
    const filePath = path.join(tmp, 'ok.bin');
    const content = Buffer.from('whisper-ok');
    fs.writeFileSync(filePath, content);
    const expected = createHash('sha256').update(content).digest('hex');
    expect(lib.verifySha256OrDelete(filePath, expected)).toBe(expected);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('pins official + brew digest URLs for v1.9.1', async () => {
    const lib = await loadLib();
    expect(lib.WHISPER_VERSION).toBe('1.9.1');
    const win = lib.getBinaryAsset('win32', 'x64');
    const lin = lib.getBinaryAsset('linux', 'x64');
    const mac = lib.getBinaryAsset('darwin', 'arm64');
    expect(win.url).toContain('/v1.9.1/whisper-bin-x64.zip');
    expect(lin.url).toContain('/v1.9.1/whisper-bin-ubuntu-x64.tar.gz');
    expect(mac.url).toContain('ghcr.io/v2/homebrew/core/whisper-cpp/blobs/sha256:');
    expect(mac.sha256).toBe(mac.url.split('sha256:')[1]);

    const model = lib.getModelAsset('base');
    expect(model.url).toContain(lib.HF_MODEL_COMMIT);
    expect(model.sha256).toHaveLength(64);
  });

  it('reports model missing when binary absent (download required)', async () => {
    const lib = await loadLib();
    const runtimeRoot = path.join(tmp, 'empty');
    const modelsRoot = path.join(tmp, 'models');
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(modelsRoot, { recursive: true });
    expect(lib.isBinaryRuntimeComplete(runtimeRoot, 'linux')).toBe(false);
    expect(lib.isModelPresent(modelsRoot, 'base')).toBe(false);
  });
});
