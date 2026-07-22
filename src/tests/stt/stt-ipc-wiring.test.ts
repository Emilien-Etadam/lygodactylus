import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('STT IPC wiring', () => {
  it('registers stt IPC outside the client-event allowlist', () => {
    const registerSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/main/ipc/register-main-ipc.ts'),
      'utf8'
    );
    expect(registerSrc).toContain("import { registerSttIpc } from './ipc-stt'");
    expect(registerSrc).toContain('registerSttIpc()');

    const preloadSrc = fs.readFileSync(path.join(process.cwd(), 'src/preload/index.ts'), 'utf8');
    expect(preloadSrc).toContain('stt:');
    expect(preloadSrc).toContain("ipcRenderer.invoke('stt.transcribe'");
    expect(preloadSrc).toContain("ipcRenderer.invoke('stt.ensure'");

    const allowlistSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/shared/client-event-allowlist.ts'),
      'utf8'
    );
    expect(allowlistSrc).not.toMatch(/stt\./);
  });
});
