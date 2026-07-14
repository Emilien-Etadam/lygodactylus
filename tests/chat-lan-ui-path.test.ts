import { describe, expect, it } from 'vitest';
import { getChatLanUiDirCandidates } from '../src/main/chat-lan-server/chat-lan-server';

describe('getChatLanUiDirCandidates', () => {
  it('prefers extraResources path when packaged', () => {
    const candidates = getChatLanUiDirCandidates({
      isPackaged: true,
      resourcesPath: 'C:/App/resources',
      appPath: 'C:/App/resources/app.asar',
      cwd: 'C:/cwd',
      moduleDir: 'C:/App/resources/app.asar/dist-electron/main/chat-lan-server',
    });

    expect(candidates[0]).toBe('C:/App/resources/chat-lan');
    expect(candidates[1]).toBe('C:/App/resources/app.asar/resources/chat-lan');
  });

  it('uses project resources in development', () => {
    const candidates = getChatLanUiDirCandidates({
      isPackaged: false,
      cwd: '/workspace',
      moduleDir: '/workspace/dist-electron/main/chat-lan-server',
    });

    expect(candidates[0]).toBe('/workspace/resources/chat-lan');
  });
});
