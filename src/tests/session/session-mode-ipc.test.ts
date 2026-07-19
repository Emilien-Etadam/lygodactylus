import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../../renderer/types';
import {
  getSessionMode,
  updateSessionMode,
} from '../../main/session/session-manager-session-lifecycle';
import type { SessionManagerFacadeSupportDeps } from '../../main/session/session-manager-facade-support';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    title: 'Test',
    status: 'idle',
    cwd: '/tmp',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: true,
    mode: 'act',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeDeps(session: Session) {
  const store = {
    loadSession: vi.fn(() => session),
  };
  const db = {
    sessions: {
      update: vi.fn(),
    },
  };
  const sendToRenderer = vi.fn();
  const clearSdkSession = vi.fn();
  const activeSessions = new Map<string, AbortController>();
  const deps = {
    store,
    db,
    sendToRenderer,
    getAgentRunner: () => ({ clearSdkSession }),
    activeSessions,
  } as unknown as SessionManagerFacadeSupportDeps;

  return { deps, store, db, sendToRenderer, clearSdkSession, activeSessions };
}

describe('session mode IPC helpers', () => {
  it('getSessionMode returns persisted mode (default act)', () => {
    const session = makeSession({ mode: 'act' });
    const { deps } = makeDeps(session);
    expect(getSessionMode(deps, 'session-1')).toEqual({ mode: 'act' });
  });

  it('setSessionMode persists plan and clears cached pi session', () => {
    const session = makeSession({ mode: 'act' });
    const { deps, db, sendToRenderer, clearSdkSession } = makeDeps(session);

    const updated = updateSessionMode(deps, 'session-1', 'plan');

    expect(updated.mode).toBe('plan');
    expect(db.sessions.update).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ mode: 'plan' })
    );
    expect(clearSdkSession).toHaveBeenCalledWith('session-1');
    expect(sendToRenderer).toHaveBeenCalledWith({
      type: 'session.update',
      payload: {
        sessionId: 'session-1',
        updates: expect.objectContaining({ mode: 'plan' }),
      },
    });
  });

  it('rejects mode changes while a run is in progress', () => {
    const session = makeSession({ status: 'running' });
    const { deps } = makeDeps(session);
    expect(() => updateSessionMode(deps, 'session-1', 'plan')).toThrow(
      /while a run is in progress/
    );
  });

  it('rejects mode changes when session is in activeSessions', () => {
    const session = makeSession({ status: 'idle' });
    const { deps, activeSessions } = makeDeps(session);
    activeSessions.set('session-1', new AbortController());
    expect(() => updateSessionMode(deps, 'session-1', 'plan')).toThrow(
      /while a run is in progress/
    );
  });

  it('round-trips set then get', () => {
    let session = makeSession({ mode: 'act' });
    const store = {
      loadSession: vi.fn(() => session),
    };
    const db = {
      sessions: {
        update: vi.fn((_id: string, updates: { mode?: string }) => {
          if (updates.mode) {
            session = { ...session, mode: updates.mode as Session['mode'] };
          }
        }),
      },
    };
    const deps = {
      store,
      db,
      sendToRenderer: vi.fn(),
      getAgentRunner: () => ({ clearSdkSession: vi.fn() }),
      activeSessions: new Map(),
    } as unknown as SessionManagerFacadeSupportDeps;

    updateSessionMode(deps, 'session-1', 'plan');
    expect(getSessionMode(deps, 'session-1')).toEqual({ mode: 'plan' });
    updateSessionMode(deps, 'session-1', 'act');
    expect(getSessionMode(deps, 'session-1')).toEqual({ mode: 'act' });
  });
});
