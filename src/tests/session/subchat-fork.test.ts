import { describe, expect, it, vi } from 'vitest';
import type { Message, Session } from '../../renderer/types';
import type { DatabaseInstance, SessionRow } from '../../main/db/database';
import { forkSessionFromMessage } from '../../main/session/session-manager-message-branch';
import type { SessionManagerFacadeSupportDeps } from '../../main/session/session-manager-facade-support';
import { SessionManagerStore } from '../../main/session/session-manager-store';

function makeSession(partial: Partial<Session> & Pick<Session, 'id' | 'title'>): Session {
  return {
    status: 'idle',
    mountedPaths: [],
    allowedTools: ['read'],
    memoryEnabled: false,
    mode: 'act',
    autonomy: 'normal',
    folderId: null,
    parentSessionId: null,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function makeDb(sessions: Map<string, SessionRow>): DatabaseInstance {
  return {
    sessions: {
      create: vi.fn((row: SessionRow) => {
        sessions.set(row.id, { ...row });
      }),
      update: vi.fn((id: string, updates: Partial<SessionRow>) => {
        const existing = sessions.get(id);
        if (!existing) return;
        sessions.set(id, { ...existing, ...updates, updated_at: Date.now() });
      }),
      get: vi.fn((id: string) => sessions.get(id)),
      getAll: vi.fn(() => Array.from(sessions.values())),
      delete: vi.fn(),
    },
    folders: {
      create: vi.fn(),
      update: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn(() => []),
      delete: vi.fn(),
      clearSessionFolderRefs: vi.fn(),
    },
    messages: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
      deleteFromTimestamp: vi.fn(),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
      deleteFromTimestamp: vi.fn(),
    },
    scheduledTasks: {
      create: vi.fn(),
      update: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn(() => []),
      delete: vi.fn(),
    },
    prepare: vi.fn(),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
    raw: {} as DatabaseInstance['raw'],
  } as unknown as DatabaseInstance;
}

describe('sub-chat fork', () => {
  it('reuses fork and sets parent_session_id for assistant anchors', async () => {
    const parent = makeSession({
      id: 'parent-1',
      title: 'Main chat',
      folderId: 'folder-a',
      cwd: '/tmp/ws',
    });
    const rows = new Map<string, SessionRow>([
      [
        parent.id,
        {
          id: parent.id,
          title: parent.title,
          claude_session_id: null,
          openai_thread_id: null,
          status: 'idle',
          cwd: '/tmp/ws',
          mounted_paths: '[]',
          allowed_tools: '["read"]',
          memory_enabled: 0,
          mode: 'act',
          autonomy: 'normal',
          model: null,
          folder_id: 'folder-a',
          parent_session_id: null,
          created_at: 1,
          updated_at: 1,
        },
      ],
    ]);
    const db = makeDb(rows);
    const store = new SessionManagerStore(db);
    const messages: Message[] = [
      {
        id: 'u1',
        sessionId: parent.id,
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        timestamp: 10,
      },
      {
        id: 'a1',
        sessionId: parent.id,
        role: 'assistant',
        content: [{ type: 'text', text: 'hi there' }],
        timestamp: 20,
      },
    ];

    const deps = {
      db,
      store,
      loadSession: (id: string) => store.loadSession(id),
      getMessages: () => messages,
      saveMessage: vi.fn(),
      sendToRenderer: vi.fn(),
      activeSessions: new Map(),
      workspaceMountVirtualPath: '/mnt/workspace',
    } as unknown as SessionManagerFacadeSupportDeps;

    const result = await forkSessionFromMessage(
      deps,
      vi.fn(),
      (title, cwd, allowedTools, memoryEnabled) =>
        makeSession({
          id: 'child-1',
          title,
          cwd,
          allowedTools: allowedTools ?? ['read'],
          memoryEnabled: memoryEnabled ?? false,
        }),
      parent.id,
      'a1',
      true
    );

    expect(result.success).toBe(true);
    expect(result.newSession?.parentSessionId).toBe('parent-1');
    expect(result.newSession?.folderId).toBe('folder-a');
    expect(result.newSession?.title.startsWith('↳')).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(rows.get('child-1')?.parent_session_id).toBe('parent-1');
    expect(rows.get('child-1')?.folder_id).toBe('folder-a');
  });

  it('keeps classic user-message fork without parent_session_id', async () => {
    const parent = makeSession({ id: 'parent-2', title: 'Main' });
    const rows = new Map<string, SessionRow>([
      [
        parent.id,
        {
          id: parent.id,
          title: parent.title,
          claude_session_id: null,
          openai_thread_id: null,
          status: 'idle',
          cwd: null,
          mounted_paths: '[]',
          allowed_tools: '[]',
          memory_enabled: 0,
          mode: 'act',
          autonomy: 'normal',
          model: null,
          folder_id: null,
          parent_session_id: null,
          created_at: 1,
          updated_at: 1,
        },
      ],
    ]);
    const db = makeDb(rows);
    const store = new SessionManagerStore(db);
    const messages: Message[] = [
      {
        id: 'u1',
        sessionId: parent.id,
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        timestamp: 10,
      },
    ];

    const deps = {
      db,
      store,
      loadSession: (id: string) => store.loadSession(id),
      getMessages: () => messages,
      saveMessage: vi.fn(),
      sendToRenderer: vi.fn(),
      activeSessions: new Map(),
      workspaceMountVirtualPath: '/mnt/workspace',
    } as unknown as SessionManagerFacadeSupportDeps;

    const result = await forkSessionFromMessage(
      deps,
      vi.fn(),
      (title) => makeSession({ id: 'fork-1', title }),
      parent.id,
      'u1',
      false
    );

    expect(result.success).toBe(true);
    expect(result.newSession?.parentSessionId).toBeNull();
    expect(rows.get('fork-1')?.parent_session_id).toBeNull();
  });
});
