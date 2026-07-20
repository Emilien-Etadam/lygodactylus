import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../../renderer/types';
import {
  getSessionAutonomy,
  updateSessionAutonomy,
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
    autonomy: 'normal',
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

describe('session autonomy IPC helpers', () => {
  it('getSessionAutonomy returns persisted autonomy (default normal)', () => {
    const session = makeSession({ autonomy: 'normal' });
    const { deps } = makeDeps(session);
    expect(getSessionAutonomy(deps, 'session-1')).toEqual({ autonomy: 'normal' });
  });

  it('setSessionAutonomy persists careful without clearing the cached pi session', () => {
    const session = makeSession({ autonomy: 'normal' });
    const { deps, db, sendToRenderer, clearSdkSession } = makeDeps(session);

    const updated = updateSessionAutonomy(deps, 'session-1', 'careful');

    expect(updated.autonomy).toBe('careful');
    expect(db.sessions.update).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ autonomy: 'careful' })
    );
    // Live getAutonomy reads the store; no need to recreate the pi session.
    expect(clearSdkSession).not.toHaveBeenCalled();
    expect(sendToRenderer).toHaveBeenCalledWith({
      type: 'session.update',
      payload: {
        sessionId: 'session-1',
        updates: expect.objectContaining({ autonomy: 'careful' }),
      },
    });
  });

  it('rejects autonomy changes while a run is in progress', () => {
    const session = makeSession({ status: 'running' });
    const { deps } = makeDeps(session);
    expect(() => updateSessionAutonomy(deps, 'session-1', 'autonomous')).toThrow(
      /while a run is in progress/
    );
  });

  it('rejects autonomy changes when session is in activeSessions', () => {
    const session = makeSession({ status: 'idle' });
    const { deps, activeSessions } = makeDeps(session);
    activeSessions.set('session-1', new AbortController());
    expect(() => updateSessionAutonomy(deps, 'session-1', 'careful')).toThrow(
      /while a run is in progress/
    );
  });

  it('round-trips set then get', () => {
    let session = makeSession({ autonomy: 'normal' });
    const store = {
      loadSession: vi.fn(() => session),
    };
    const db = {
      sessions: {
        update: vi.fn((_id: string, updates: { autonomy?: string }) => {
          if (updates.autonomy) {
            session = {
              ...session,
              autonomy: updates.autonomy as Session['autonomy'],
            };
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

    updateSessionAutonomy(deps, 'session-1', 'careful');
    expect(getSessionAutonomy(deps, 'session-1')).toEqual({ autonomy: 'careful' });
    updateSessionAutonomy(deps, 'session-1', 'autonomous');
    expect(getSessionAutonomy(deps, 'session-1')).toEqual({ autonomy: 'autonomous' });
    updateSessionAutonomy(deps, 'session-1', 'normal');
    expect(getSessionAutonomy(deps, 'session-1')).toEqual({ autonomy: 'normal' });
  });
});
