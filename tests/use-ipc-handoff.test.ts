import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const useSessionIpcPath = path.resolve(process.cwd(), 'src/renderer/hooks/ipc/useSessionIpc.ts');
const useSessionIpcContent = readFileSync(useSessionIpcPath, 'utf8');

describe('useIPC handoff session bootstrap', () => {
  it('adds the initial handoff message and switches active session', () => {
    expect(useSessionIpcContent).toContain('initialContent');
    expect(useSessionIpcContent).toContain('addMessage(newSession.id, userMessage)');
    expect(useSessionIpcContent).toContain('setActiveSession(newSession.id)');
    expect(useSessionIpcContent).toContain('startExecutionClock(newSession.id, userMessage.timestamp)');
  });
});
