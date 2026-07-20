import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readProjectFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('session search wiring', () => {
  it('registers desktop IPC and preload bridge without client-event-allowlist', () => {
    const ipcSource = readProjectFile('src/main/ipc/ipc-session-search.ts');
    const registerMain = readProjectFile('src/main/ipc/register-main-ipc.ts');
    const preload = readProjectFile('src/preload/index.ts');
    const allowlist = readProjectFile('src/shared/client-event-allowlist.ts');
    const sidebar = readProjectFile('src/renderer/components/Sidebar.tsx');

    expect(ipcSource).toContain("'session.searchMessages'");
    expect(ipcSource).toContain('ipcMain.handle');
    expect(registerMain).toContain('registerSessionSearchIpc');
    expect(preload).toContain("ipcRenderer.invoke('session.searchMessages'");
    expect(preload).toContain('session: {');
    expect(allowlist).not.toContain('session.searchMessages');
    expect(sidebar).toContain('window.electronAPI.session');
    expect(sidebar).toContain('searchMessages');
  });
});
