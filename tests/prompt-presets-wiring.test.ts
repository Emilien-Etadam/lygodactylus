import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isAllowedClientEventType } from '../src/shared/client-event-allowlist';

const registerPath = path.resolve(process.cwd(), 'src/main/ipc/register-main-ipc.ts');
const preloadPath = path.resolve(process.cwd(), 'src/preload/index.ts');
const ipcPath = path.resolve(process.cwd(), 'src/main/ipc/ipc-prompt-presets.ts');

describe('prompt presets IPC wiring', () => {
  it('registers invoke handlers outside the client-event allowlist', () => {
    const registerContent = readFileSync(registerPath, 'utf8');
    const preloadContent = readFileSync(preloadPath, 'utf8');
    const ipcContent = readFileSync(ipcPath, 'utf8');

    expect(registerContent).toContain('registerPromptPresetsIpc');
    expect(ipcContent).toContain("ipcMain.handle('presets.list'");
    expect(ipcContent).toContain("ipcMain.handle('presets.create'");
    expect(preloadContent).toContain("ipcRenderer.invoke('presets.list')");
    expect(preloadContent).toContain('presets:');

    expect(isAllowedClientEventType('presets.list')).toBe(false);
    expect(isAllowedClientEventType('presets.create')).toBe(false);
  });
});
