import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readProjectFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('chat folders wiring', () => {
  it('registers desktop folder IPC without client-event-allowlist entries', () => {
    const ipcSource = readProjectFile('src/main/ipc/ipc-chat-folders.ts');
    const registerMain = readProjectFile('src/main/ipc/register-main-ipc.ts');
    const preload = readProjectFile('src/preload/index.ts');
    const allowlist = readProjectFile('src/shared/client-event-allowlist.ts');
    const clientEvents = readProjectFile('src/main/main-client-events.ts');

    expect(ipcSource).toContain("'folder.create'");
    expect(ipcSource).toContain("'folder.update'");
    expect(ipcSource).toContain("'folder.delete'");
    expect(ipcSource).toContain("'folder.assign'");
    expect(ipcSource).toContain('ipcMain.handle');
    expect(registerMain).toContain('registerChatFoldersIpc');
    expect(preload).toContain("ipcRenderer.invoke('folder.create'");
    expect(preload).toContain('folders: {');
    expect(allowlist).not.toContain('folder.create');
    expect(allowlist).not.toContain('folder.assign');
    expect(allowlist).toContain('session.list');
    expect(clientEvents).toContain('safeListChatFolders');
    expect(clientEvents).toContain('folders');
  });
});
