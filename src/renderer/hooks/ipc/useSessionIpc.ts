import { useCallback } from 'react';
import { useAppStore } from '../../store';
import type {
  ClientEvent,
  Session,
  Message,
  TraceStep,
  ContentBlock,
} from '../../types';
import i18n from '../../i18n/config';
import { isElectron } from './constants';

export interface SessionIpcDeps {
  invoke: <T>(event: ClientEvent) => Promise<T>;
  send: (event: ClientEvent) => void;
  addSession: (session: Session) => void;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
  addMessage: (sessionId: string, message: Message) => void;
  setLoading: (loading: boolean) => void;
  activateNextTurn: (sessionId: string, stepId: string) => void;
  startActiveTurn: (sessionId: string, stepId: string, messageId: string) => void;
  clearActiveTurn: (sessionId: string, stepId?: string) => void;
  clearPendingTurns: (sessionId: string) => void;
  cancelQueuedMessages: (sessionId: string) => void;
  startExecutionClock: (sessionId: string, timestamp: number) => void;
  finishExecutionClock: (sessionId: string) => void;
}

export function useSessionIpc({
  invoke,
  send,
  addSession,
  updateSession,
  addMessage,
  setLoading,
  activateNextTurn,
  startActiveTurn,
  clearActiveTurn,
  clearPendingTurns,
  cancelQueuedMessages,
  startExecutionClock,
  finishExecutionClock,
}: SessionIpcDeps) {
  // Start a new session
  const startSession = useCallback(
    async (title: string, promptOrContent: string | ContentBlock[], cwd?: string) => {
      setLoading(true);
      console.log('[useIPC] Starting session:', title);

      // Normalize input to ContentBlock array
      const content: ContentBlock[] =
        typeof promptOrContent === 'string'
          ? [{ type: 'text', text: promptOrContent }]
          : promptOrContent;

      // Extract text for legacy backend and session title (if needed)
      const textContent = content.find((block) => block.type === 'text');
      const prompt = textContent && 'text' in textContent ? textContent.text : '';

      // Browser mode mock
      if (!isElectron) {
        const sessionId = `mock-session-${Date.now()}`;
        const session: Session = {
          id: sessionId,
          title: title || 'New Session',
          status: 'running',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          cwd: cwd || '',
          mountedPaths: [],
          allowedTools: [
            'webfetch',
            'websearch',
            'read',
            'write',
            'edit',
            'list_directory',
            'glob',
            'grep',
          ],
          memoryEnabled: true,
          mode: 'act' as const,
        };

        addSession(session);
        useAppStore.getState().setActiveSession(sessionId);

        const userMessage: Message = {
          id: `msg-user-${Date.now()}`,
          sessionId,
          role: 'user',
          content,
          timestamp: Date.now(),
        };
        addMessage(sessionId, userMessage);
        startExecutionClock(sessionId, userMessage.timestamp);
        const mockStepId = `mock-step-${Date.now()}`;
        startActiveTurn(sessionId, mockStepId, userMessage.id);

        await new Promise((resolve) => setTimeout(resolve, 500));

        const assistantMessage: Message = {
          id: `msg-assistant-${Date.now()}`,
          sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: `Mock response to: "${prompt}"` }],
          timestamp: Date.now(),
        };
        addMessage(sessionId, assistantMessage);

        updateSession(sessionId, { status: 'idle' });
        clearActiveTurn(sessionId, mockStepId);
        setLoading(false);

        return session;
      }

      // Electron mode
      try {
        // Generate the message id renderer-side and share it with the backend so
        // the optimistic UI message and the persisted one keep the same id
        // (required for fork / edit prompt actions).
        const messageId = `msg-user-${crypto.randomUUID()}`;
        const session = await invoke<Session>({
          type: 'session.start',
          payload: {
            title,
            prompt,
            cwd,
            content, // Send full content blocks including images
            messageId,
          },
        });
        if (session) {
          addSession(session);
          useAppStore.getState().setActiveSession(session.id);

          // Immediately add user message to UI
          const userMessage: Message = {
            id: messageId,
            sessionId: session.id,
            role: 'user',
            content,
            timestamp: Date.now(),
          };
          addMessage(session.id, userMessage);
          startExecutionClock(session.id, userMessage.timestamp);

          // Immediately activate turn to show processing indicator while waiting for API
          const mockStepId = `pending-step-${Date.now()}`;
          startActiveTurn(session.id, mockStepId, userMessage.id);
        }
        // Loading will be reset when we receive session.status event
        return session;
      } catch (e) {
        setLoading(false);
        useAppStore.getState().setGlobalNotice({
          id: `notice-session-start-${Date.now()}`,
          type: 'error',
          message: e instanceof Error ? e.message : i18n.t('chat.startFailed'),
          messageKey: e instanceof Error ? undefined : 'chat.startFailed',
        });
        return null;
      }
    },
    [
      invoke,
      addSession,
      addMessage,
      updateSession,
      setLoading,
      activateNextTurn,
      startActiveTurn,
      clearActiveTurn,
      startExecutionClock,
    ]
  );

  // Continue an existing session
  const continueSession = useCallback(
    async (sessionId: string, promptOrContent: string | ContentBlock[]) => {
      setLoading(true);
      console.log('[useIPC] Continuing session:', sessionId);

      // Normalize input to ContentBlock array
      const content: ContentBlock[] =
        typeof promptOrContent === 'string'
          ? [{ type: 'text', text: promptOrContent }]
          : promptOrContent;

      // Extract text for legacy backend (if needed)
      const textContent = content.find((block) => block.type === 'text');
      const prompt = textContent && 'text' in textContent ? textContent.text : '';

      // Immediately add user message to UI (for both modes)
      const store = useAppStore.getState();
      const isSessionRunning =
        store.sessions.find((session) => session.id === sessionId)?.status === 'running';
      const ss = store.sessionStates[sessionId];
      const hasPending = (ss?.pendingTurns?.length ?? 0) > 0;
      const shouldQueue = isSessionRunning || hasPending;
      const userMessage: Message = {
        // Shared with the backend (session.continue payload) so the persisted
        // message keeps this id — fork / edit prompt look messages up by id.
        id: `msg-user-${crypto.randomUUID()}`,
        sessionId,
        role: 'user',
        content,
        timestamp: Date.now(),
        localStatus: shouldQueue ? 'queued' : undefined,
      };
      addMessage(sessionId, userMessage);
      startExecutionClock(sessionId, userMessage.timestamp);

      // Browser mode mock
      if (!isElectron) {
        updateSession(sessionId, { status: 'running' });
        const mockStepId = `mock-step-${Date.now()}`;
        startActiveTurn(sessionId, mockStepId, userMessage.id);

        await new Promise((resolve) => setTimeout(resolve, 500));

        const assistantMessage: Message = {
          id: `msg-assistant-${Date.now()}`,
          sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: `Mock response to: "${prompt}"` }],
          timestamp: Date.now(),
        };
        addMessage(sessionId, assistantMessage);

        updateSession(sessionId, { status: 'idle' });
        clearActiveTurn(sessionId, mockStepId);
        clearPendingTurns(sessionId);
        setLoading(false);
        return;
      }

      // Electron mode - send to backend (user message already added above)
      // Immediately activate turn to show processing indicator while waiting for API
      if (!shouldQueue) {
        const mockStepId = `pending-step-${Date.now()}`;
        startActiveTurn(sessionId, mockStepId, userMessage.id);
      }

      try {
        send({
          type: 'session.continue',
          payload: {
            sessionId,
            prompt,
            content, // Send full content blocks including images
            messageId: userMessage.id,
          },
        });
        // Loading will be reset when we receive session.status event
      } catch (e) {
        setLoading(false);
        useAppStore.getState().setGlobalNotice({
          id: `notice-session-continue-${Date.now()}`,
          type: 'error',
          message: e instanceof Error ? e.message : i18n.t('chat.startFailed'),
          messageKey: e instanceof Error ? undefined : 'chat.startFailed',
        });
      }
    },
    [
      send,
      addMessage,
      updateSession,
      setLoading,
      activateNextTurn,
      startActiveTurn,
      clearActiveTurn,
      clearPendingTurns,
      startExecutionClock,
    ]
  );

  const compactSession = useCallback(
    async (
      sessionId: string,
      customInstructions?: string
    ): Promise<{ success: boolean; errorKey?: string }> => {
      if (!isElectron) {
        return { success: false, errorKey: 'errCompactFailed' };
      }

      try {
        const result = await invoke<{ success: boolean; errorKey?: string; error?: string }>({
          type: 'session.compact',
          payload: { sessionId, customInstructions },
        });
        if (!result.success) {
          const noticeKey = result.errorKey || 'errCompactFailed';
          useAppStore.getState().setGlobalNotice({
            id: `notice-compact-${Date.now()}`,
            type: 'warning',
            message: i18n.t(`chat.compactErrors.${noticeKey}`, {
              defaultValue: result.error || noticeKey,
            }),
            messageKey: `chat.compactErrors.${noticeKey}`,
          });
        }
        return result;
      } catch (error) {
        useAppStore.getState().setGlobalNotice({
          id: `notice-compact-${Date.now()}`,
          type: 'error',
          message:
            error instanceof Error ? error.message : i18n.t('chat.compactErrors.errCompactFailed'),
          messageKey: 'chat.compactErrors.errCompactFailed',
        });
        return { success: false, errorKey: 'errCompactFailed' };
      }
    },
    [invoke]
  );

  const handoffSession = useCallback(
    async (
      sessionId: string,
      customInstructions?: string
    ): Promise<{ success: boolean; errorKey?: string }> => {
      if (!isElectron) {
        return { success: false, errorKey: 'errHandoffFailed' };
      }

      setLoading(true);
      try {
        // Same id renderer/backend so fork / edit prompt keep working on the
        // first message of the handoff session.
        const messageId = `msg-user-${crypto.randomUUID()}`;
        const result = await invoke<{
          success: boolean;
          newSession?: Session;
          initialContent?: ContentBlock[];
          errorKey?: string;
          error?: string;
        } | null>({
          type: 'session.handoff',
          payload: { sessionId, customInstructions, messageId },
        });

        if (!result?.success || !result.newSession) {
          setLoading(false);
          const noticeKey = result?.errorKey || 'errHandoffFailed';
          useAppStore.getState().setGlobalNotice({
            id: `notice-handoff-${Date.now()}`,
            type: 'warning',
            message: i18n.t(`chat.handoffErrors.${noticeKey}`, {
              defaultValue: result?.error || noticeKey,
            }),
            messageKey: `chat.handoffErrors.${noticeKey}`,
          });
          return { success: false, errorKey: noticeKey };
        }

        const { newSession, initialContent } = result;
        addSession(newSession);
        const store = useAppStore.getState();
        store.setShowSettings(false);
        store.setActiveSession(newSession.id);

        const content: ContentBlock[] =
          initialContent && initialContent.length > 0
            ? initialContent
            : [{ type: 'text', text: '' }];

        const userMessage: Message = {
          id: messageId,
          sessionId: newSession.id,
          role: 'user',
          content,
          timestamp: Date.now(),
        };
        addMessage(newSession.id, userMessage);
        startExecutionClock(newSession.id, userMessage.timestamp);

        const mockStepId = `pending-handoff-${Date.now()}`;
        startActiveTurn(newSession.id, mockStepId, userMessage.id);
        store.setGlobalNotice({
          id: `notice-handoff-${Date.now()}`,
          type: 'success',
          message: i18n.t('chat.handoffSuccess'),
          messageKey: 'chat.handoffSuccess',
        });

        return { success: true };
      } catch (error) {
        setLoading(false);
        useAppStore.getState().setGlobalNotice({
          id: `notice-handoff-${Date.now()}`,
          type: 'error',
          message:
            error instanceof Error ? error.message : i18n.t('chat.handoffErrors.errHandoffFailed'),
          messageKey: 'chat.handoffErrors.errHandoffFailed',
        });
        return { success: false, errorKey: 'errHandoffFailed' };
      }
    },
    [invoke, addSession, addMessage, setLoading, startActiveTurn, startExecutionClock]
  );

  const forkSessionFromMessage = useCallback(
    async (
      sessionId: string,
      messageId: string
    ): Promise<{ success: boolean; newSessionId?: string; errorKey?: string }> => {
      if (!isElectron) {
        return { success: false, errorKey: 'errForkFailed' };
      }

      try {
        const result = await invoke<{
          success: boolean;
          newSession?: Session;
          messages?: Message[];
          errorKey?: string;
          error?: string;
        }>({
          type: 'session.forkFromMessage',
          payload: { sessionId, messageId },
        });

        if (!result?.success || !result.newSession) {
          const noticeKey = result?.errorKey || 'errForkFailed';
          useAppStore.getState().setGlobalNotice({
            id: `notice-fork-${Date.now()}`,
            type: 'warning',
            message: i18n.t(`chat.forkErrors.${noticeKey}`, {
              defaultValue: result?.error || noticeKey,
            }),
            messageKey: `chat.forkErrors.${noticeKey}`,
          });
          return { success: false, errorKey: noticeKey };
        }

        const store = useAppStore.getState();
        store.addSession(result.newSession);
        if (result.messages) {
          store.setMessages(result.newSession.id, result.messages);
        }
        store.setShowSettings(false);
        store.setActiveSession(result.newSession.id);
        store.setGlobalNotice({
          id: `notice-fork-${Date.now()}`,
          type: 'success',
          message: i18n.t('chat.forkSuccess'),
          messageKey: 'chat.forkSuccess',
        });

        return { success: true, newSessionId: result.newSession.id };
      } catch (error) {
        useAppStore.getState().setGlobalNotice({
          id: `notice-fork-${Date.now()}`,
          type: 'error',
          message: error instanceof Error ? error.message : i18n.t('chat.forkErrors.errForkFailed'),
          messageKey: 'chat.forkErrors.errForkFailed',
        });
        return { success: false, errorKey: 'errForkFailed' };
      }
    },
    [invoke]
  );

  const rewindSessionForEdit = useCallback(
    async (
      sessionId: string,
      messageId: string
    ): Promise<{ success: boolean; promptText?: string; errorKey?: string }> => {
      if (!isElectron) {
        return { success: false, errorKey: 'errRewindFailed' };
      }

      try {
        const result = await invoke<{
          success: boolean;
          promptText?: string;
          messages?: Message[];
          errorKey?: string;
          error?: string;
        }>({
          type: 'session.rewindToMessage',
          payload: { sessionId, messageId },
        });

        if (!result?.success) {
          const noticeKey = result?.errorKey || 'errRewindFailed';
          useAppStore.getState().setGlobalNotice({
            id: `notice-rewind-${Date.now()}`,
            type: 'warning',
            message: i18n.t(`chat.rewindErrors.${noticeKey}`, {
              defaultValue: result?.error || noticeKey,
            }),
            messageKey: `chat.rewindErrors.${noticeKey}`,
          });
          return { success: false, errorKey: noticeKey };
        }

        const store = useAppStore.getState();
        if (result.messages) {
          store.setMessages(sessionId, result.messages);
        }
        store.setTraceSteps(sessionId, []);
        store.clearPartialMessage(sessionId);
        store.clearPartialThinking(sessionId);
        store.clearActiveTurn(sessionId);
        store.clearPendingTurns(sessionId);
        store.clearExecutionClock(sessionId);
        store.clearQueuedMessages(sessionId);
        store.setLoading(false);

        return { success: true, promptText: result.promptText ?? '' };
      } catch (error) {
        useAppStore.getState().setGlobalNotice({
          id: `notice-rewind-${Date.now()}`,
          type: 'error',
          message:
            error instanceof Error ? error.message : i18n.t('chat.rewindErrors.errRewindFailed'),
          messageKey: 'chat.rewindErrors.errRewindFailed',
        });
        return { success: false, errorKey: 'errRewindFailed' };
      }
    },
    [invoke]
  );

  const stopSession = useCallback(
    (sessionId: string) => {
      cancelQueuedMessages(sessionId);
      clearPendingTurns(sessionId);
      clearActiveTurn(sessionId);
      finishExecutionClock(sessionId);
      if (!isElectron) {
        updateSession(sessionId, { status: 'idle' });
        setLoading(false);
        return;
      }
      send({ type: 'session.stop', payload: { sessionId } });
      setLoading(false);
    },
    [
      send,
      updateSession,
      setLoading,
      cancelQueuedMessages,
      clearPendingTurns,
      clearActiveTurn,
      finishExecutionClock,
    ]
  );

  const deleteSession = useCallback(
    (sessionId: string) => {
      useAppStore.getState().removeSession(sessionId);
      if (isElectron) {
        send({ type: 'session.delete', payload: { sessionId } });
      }
    },
    [send]
  );

  const batchDeleteSessions = useCallback(
    (sessionIds: string[]) => {
      useAppStore.getState().removeSessions(sessionIds);
      if (isElectron) {
        send({ type: 'session.batchDelete', payload: { sessionIds } });
      }
    },
    [send]
  );

  const listSessions = useCallback(() => {
    if (!isElectron) return;
    send({ type: 'session.list', payload: {} });
  }, [send]);

  // Get messages for a session (from persistent storage)
  const getSessionMessages = useCallback(
    async (sessionId: string): Promise<Message[]> => {
      if (!isElectron) {
        console.log('[useIPC] Browser mode - no persistent messages');
        return [];
      }
      console.log('[useIPC] Getting messages for session:', sessionId);
      const messages = await invoke<Message[]>({
        type: 'session.getMessages',
        payload: { sessionId },
      });
      return messages || [];
    },
    [invoke]
  );

  const getSessionTraceSteps = useCallback(
    async (sessionId: string): Promise<TraceStep[]> => {
      if (!isElectron) {
        console.log('[useIPC] Browser mode - no persistent trace steps');
        return [];
      }
      return (
        (await invoke<TraceStep[]>({ type: 'session.getTraceSteps', payload: { sessionId } })) || []
      );
    },
    [invoke]
  );

  return {
    startSession,
    continueSession,
    compactSession,
    handoffSession,
    forkSessionFromMessage,
    rewindSessionForEdit,
    stopSession,
    deleteSession,
    batchDeleteSessions,
    listSessions,
    getSessionMessages,
    getSessionTraceSteps,
  };
}
