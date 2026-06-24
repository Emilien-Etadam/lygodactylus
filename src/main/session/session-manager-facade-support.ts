import { v4 as uuidv4 } from 'uuid';
import type { ContentBlock, Message, ServerEvent, Session } from '../../renderer/types';
import type { DatabaseInstance } from '../db/database';
import { generateTitleWithClaudeSdk } from '../claude/claude-sdk-one-shot';
import { configStore } from '../config/config-store';
import { forgetSessionPermissions } from '../config/permission-rules-store';
import type { AgentRuntimeExtensionManager } from '../extensions/agent-runtime-extension-manager';
import {
  SandboxAdapter,
  getSandboxAdapter,
  initializeSandbox,
  reinitializeSandbox,
} from '../sandbox/sandbox-adapter';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { log, logError, logWarn } from '../utils/logger';
import {
  buildCompactionHandoffPrompt,
  buildCompactionSessionTitle,
} from '../../shared/compaction-handoff';
import { buildScheduledTaskTitle } from '../../shared/schedule/task-title';
import type { PromptQueues, SessionManagerAgentRunner } from './session-manager-queue';
import { SessionManagerStore } from './session-manager-store';
import { maybeGenerateSessionTitle } from './session-title-flow';
import {
  buildTitlePrompt,
  getDefaultTitleFromPrompt,
  normalizeGeneratedTitle,
} from './session-title-utils';

const TITLE_GENERATION_TIMEOUT_MS = 20000;

export interface SessionManagerFacadeAgentRunner extends SessionManagerAgentRunner {
  cancel(sessionId: string): void;
  compactSession?(
    session: Session,
    customInstructions?: string
  ): Promise<{ summary: string; tokensBefore: number }>;
  summarizeForHandoff?(
    session: Session,
    messages: Message[],
    customInstructions?: string
  ): Promise<{ summary: string; tokensBefore: number }>;
  clearSdkSession?(sessionId: string): void;
  clearAllSdkSessions?(): void;
}

interface SessionManagerFacadeSupportDeps {
  db: DatabaseInstance;
  store: SessionManagerStore;
  sendToRenderer: (event: ServerEvent) => void;
  getAgentRunner: () => SessionManagerFacadeAgentRunner;
  activeSessions: Map<string, AbortController>;
  promptQueues: PromptQueues;
  pendingSudoPasswords: Map<
    string,
    { sessionId: string; resolve: (password: string | null) => void }
  >;
  sandboxInitPromises: Map<string, Promise<void>>;
  sessionTitleAttempts: Set<string>;
  titleGenerationTokens: Map<string, symbol>;
  getSandboxAdapter: () => SandboxAdapter;
  setSandboxAdapter: (adapter: SandboxAdapter) => void;
  loadSession: (sessionId: string) => Session | null;
  getMessages: (sessionId: string) => Message[];
  saveMessage: (message: Message) => void;
  startSession: (
    title: string,
    prompt: string,
    cwd?: string,
    allowedTools?: string[],
    content?: ContentBlock[],
    memoryEnabled?: boolean
  ) => Promise<Session>;
  extensionManager?: AgentRuntimeExtensionManager;
  workspaceMountVirtualPath: string;
}

export class SessionManagerFacadeSupport {
  constructor(private readonly deps: SessionManagerFacadeSupportDeps) {}

  async reloadSandbox(): Promise<void> {
    try {
      log('[SessionManager] Reinitializing sandbox adapter...');
      await reinitializeSandbox();
      this.deps.setSandboxAdapter(getSandboxAdapter());
      log(
        '[SessionManager] Sandbox adapter reinitialized, mode:',
        this.deps.getSandboxAdapter().mode
      );
    } catch (error) {
      logError('[SessionManager] Failed to reinitialize sandbox:', error);
    }
  }

  createSession(
    title: string,
    cwd?: string,
    allowedTools?: string[],
    memoryEnabled?: boolean
  ): Session {
    const now = Date.now();
    const envCwd = process.env.COWORK_WORKDIR || process.env.WORKDIR || process.env.DEFAULT_CWD;
    const effectiveCwd = cwd || envCwd;
    const resolvedMemoryEnabled =
      typeof memoryEnabled === 'boolean'
        ? memoryEnabled
        : configStore.get('memoryEnabled') !== false;

    return {
      id: uuidv4(),
      title,
      status: 'idle',
      cwd: effectiveCwd,
      mountedPaths: effectiveCwd
        ? [{ virtual: this.deps.workspaceMountVirtualPath, real: effectiveCwd }]
        : [],
      allowedTools: allowedTools || [
        'askuserquestion',
        'todowrite',
        'todoread',
        'webfetch',
        'websearch',
        'read',
        'write',
        'edit',
        'list_directory',
        'glob',
        'grep',
      ],
      memoryEnabled: resolvedMemoryEnabled,
      model: configStore.get('model') || undefined,
      createdAt: now,
      updatedAt: now,
    };
  }

  async compactSession(
    sessionId: string,
    customInstructions?: string
  ): Promise<{ success: boolean; errorKey?: string; error?: string }> {
    log('[SessionManager] Manual compaction requested for session:', sessionId);
    const session = this.deps.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (this.deps.activeSessions.has(sessionId)) {
      this.stopSession(sessionId);
    }

    const agentRunner = this.deps.getAgentRunner();
    if (!agentRunner.compactSession) {
      return { success: false, errorKey: 'errCompactFailed' };
    }

    try {
      const result = await agentRunner.compactSession(session, customInstructions);
      const compactionMessage: Message = {
        id: uuidv4(),
        sessionId,
        role: 'system',
        content: [
          {
            type: 'compaction_summary',
            summary: result.summary,
            tokensBefore: result.tokensBefore,
            customInstructions,
          },
        ],
        timestamp: Date.now(),
      };
      this.deps.saveMessage(compactionMessage);
      this.deps.sendToRenderer({
        type: 'stream.message',
        payload: { sessionId, message: compactionMessage },
      });
      return { success: true };
    } catch (error) {
      const errorKey =
        error instanceof Error && error.message.startsWith('errCompact')
          ? error.message
          : undefined;
      logError('[SessionManager] Manual compaction failed:', error);
      return {
        success: false,
        errorKey,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handoffSession(
    sessionId: string,
    customInstructions?: string
  ): Promise<{
    success: boolean;
    newSession?: Session;
    initialContent?: ContentBlock[];
    errorKey?: string;
    error?: string;
  }> {
    log('[SessionManager] Handoff to new session requested for:', sessionId);
    const session = this.deps.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (this.deps.activeSessions.has(sessionId)) {
      this.stopSession(sessionId);
    }

    const messages = this.deps.getMessages(sessionId);
    if (!messages.some((message) => message.role === 'user' || message.role === 'assistant')) {
      return { success: false, errorKey: 'errHandoffNothingToSummarize' };
    }

    const agentRunner = this.deps.getAgentRunner();
    if (!agentRunner.summarizeForHandoff) {
      return { success: false, errorKey: 'errHandoffFailed' };
    }

    try {
      const result = await agentRunner.summarizeForHandoff(session, messages, customInstructions);
      const handoffPrompt = buildCompactionHandoffPrompt({
        summary: result.summary,
        sourceTitle: session.title,
        tokensBefore: result.tokensBefore,
        customInstructions,
      });
      const initialContent: ContentBlock[] = [
        {
          type: 'compaction_summary',
          summary: result.summary,
          tokensBefore: result.tokensBefore,
          customInstructions,
          sourceTitle: session.title,
        },
        { type: 'text', text: handoffPrompt },
      ];
      const newSession = await this.deps.startSession(
        buildCompactionSessionTitle(session.title),
        handoffPrompt,
        session.cwd,
        session.allowedTools,
        initialContent,
        session.memoryEnabled
      );
      return { success: true, newSession, initialContent };
    } catch (error) {
      const errorKey =
        error instanceof Error && error.message.startsWith('errHandoff')
          ? error.message
          : 'errHandoffFailed';
      logError('[SessionManager] Handoff failed:', error);
      return {
        success: false,
        errorKey,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async generateSessionTitleFromPrompt(prompt: string): Promise<string> {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      return 'New Session';
    }
    const generated = await this.withTimeout(
      this.generateTitleWithConfig(buildTitlePrompt(normalizedPrompt)),
      TITLE_GENERATION_TIMEOUT_MS,
      'session-title-preview'
    );
    return normalizeGeneratedTitle(generated) ?? getDefaultTitleFromPrompt(normalizedPrompt);
  }

  async generateScheduledTaskTitle(prompt: string): Promise<string> {
    return buildScheduledTaskTitle(await this.generateSessionTitleFromPrompt(prompt));
  }

  stopSession(sessionId: string): void {
    log('[SessionManager] Stopping session:', sessionId);
    this.deps.titleGenerationTokens.delete(sessionId);
    this.deps.getAgentRunner().cancel(sessionId);

    for (const [toolUseId, entry] of this.deps.pendingSudoPasswords) {
      if (entry.sessionId === sessionId) {
        entry.resolve(null);
        this.deps.pendingSudoPasswords.delete(toolUseId);
        this.deps.sendToRenderer({ type: 'sudo.password.dismiss', payload: { toolUseId } });
      }
    }

    this.deps.activeSessions.get(sessionId)?.abort();
    this.deps.promptQueues.delete(sessionId);
    this.deps.store.clearMessageCache(sessionId);
    this.updateSessionStatus(sessionId, 'idle');
  }

  async deleteSession(sessionId: string): Promise<void> {
    const existingSession = this.deps.loadSession(sessionId);
    this.stopSession(sessionId);

    if (SandboxSync.hasSession(sessionId)) {
      log('[SessionManager] Cleaning up sandbox for session:', sessionId);
      try {
        await SandboxSync.syncAndCleanup(sessionId);
        log('[SessionManager] Sandbox cleanup complete for session:', sessionId);
      } catch (error) {
        logError('[SessionManager] Failed to cleanup sandbox:', error);
      }
    }

    this.deps.db.sessions.delete(sessionId);
    this.deps.store.clearMessageCache(sessionId);
    this.deps.sessionTitleAttempts.delete(sessionId);
    this.deps.titleGenerationTokens.delete(sessionId);

    if (this.deps.extensionManager) {
      await this.deps.extensionManager.onSessionDeleted({ sessionId, session: existingSession });
    }
    forgetSessionPermissions(sessionId);
    log('[SessionManager] Session deleted:', sessionId);
  }

  async batchDeleteSessions(sessionIds: string[]): Promise<void> {
    const sessionsById = new Map(
      sessionIds.map((sessionId) => [sessionId, this.deps.loadSession(sessionId)] as const)
    );

    for (const sessionId of sessionIds) {
      this.stopSession(sessionId);
      if (SandboxSync.hasSession(sessionId)) {
        try {
          await SandboxSync.syncAndCleanup(sessionId);
        } catch (error) {
          logError('[SessionManager] Failed to cleanup sandbox during batch delete:', error);
        }
      }
    }

    this.deps.db.raw.transaction(() => {
      for (const sessionId of sessionIds) {
        this.deps.db.sessions.delete(sessionId);
        this.deps.store.clearMessageCache(sessionId);
        this.deps.sessionTitleAttempts.delete(sessionId);
        this.deps.titleGenerationTokens.delete(sessionId);
        forgetSessionPermissions(sessionId);
      }
    })();

    if (this.deps.extensionManager) {
      for (const sessionId of sessionIds) {
        await this.deps.extensionManager.onSessionDeleted({
          sessionId,
          session: sessionsById.get(sessionId) || null,
        });
      }
    }

    log('[SessionManager] Batch deleted sessions:', sessionIds.length);
  }

  updateSessionCwd(sessionId: string, cwd: string): void {
    if (this.deps.activeSessions.has(sessionId)) {
      logWarn(
        '[SessionManager] CWD change requested while session running; stopping active run first',
        { sessionId, cwd }
      );
      this.stopSession(sessionId);
    }

    const mountedPaths = cwd ? [{ virtual: this.deps.workspaceMountVirtualPath, real: cwd }] : [];
    this.deps.db.sessions.update(sessionId, {
      cwd,
      mounted_paths: JSON.stringify(mountedPaths),
      claude_session_id: null,
      openai_thread_id: null,
      updated_at: Date.now(),
    });
    this.deps.getAgentRunner().clearSdkSession?.(sessionId);
    this.deps.sendToRenderer({
      type: 'session.update',
      payload: { sessionId, updates: { cwd, mountedPaths } },
    });
    log('[SessionManager] Session cwd updated:', sessionId, '->', cwd, '(SDK session cleared)');
  }

  updateSessionStatus(sessionId: string, status: Session['status']): void {
    this.deps.db.sessions.update(sessionId, { status, updated_at: Date.now() });
    this.deps.sendToRenderer({ type: 'session.status', payload: { sessionId, status } });
  }

  updateSessionModel(session: Session, model: string): void {
    session.model = model;
    this.deps.db.sessions.update(session.id, { model });
    this.deps.sendToRenderer({
      type: 'session.update',
      payload: { sessionId: session.id, updates: { model } },
    });
  }

  async ensureSandboxInitialized(session: Session): Promise<void> {
    if (!session.cwd) {
      log('[SessionManager] No workspace directory, skipping sandbox init');
      return;
    }
    const sandboxAdapter = this.deps.getSandboxAdapter();
    if (sandboxAdapter.initialized && sandboxAdapter.workspacePath === session.cwd) {
      return;
    }

    const existingPromise = this.deps.sandboxInitPromises.get(session.cwd);
    if (existingPromise) {
      await existingPromise;
      return;
    }

    const initPromise = initializeSandbox({ workspacePath: session.cwd, mainWindow: null }).then(
      () => undefined
    );
    this.deps.sandboxInitPromises.set(session.cwd, initPromise);

    try {
      await initPromise;
      log('[SessionManager] Sandbox initialized for workspace:', session.cwd);
      log('[SessionManager] Sandbox mode:', this.deps.getSandboxAdapter().mode);
    } catch (error) {
      logError('[SessionManager] Failed to initialize sandbox:', error);
      this.deps.sendToRenderer({
        type: 'error',
        payload: {
          message: `Failed to initialize sandbox: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    } finally {
      this.deps.sandboxInitPromises.delete(session.cwd);
    }
  }

  async runSessionTitleGeneration(
    session: Session,
    prompt: string,
    existingMessages: Message[]
  ): Promise<void> {
    const token = Symbol(`title:${session.id}`);
    this.deps.titleGenerationTokens.set(session.id, token);
    const shouldAbort = () =>
      this.deps.titleGenerationTokens.get(session.id) !== token ||
      !this.deps.db.sessions.get(session.id);

    try {
      await maybeGenerateSessionTitle({
        sessionId: session.id,
        prompt,
        userMessageCount: existingMessages.filter((message) => message.role === 'user').length + 1,
        currentTitle: session.title,
        hasAttempted: this.deps.sessionTitleAttempts.has(session.id),
        generateTitle: async (titlePrompt) => {
          if (shouldAbort()) {
            return null;
          }
          const title = await this.withTimeout(
            this.generateTitleWithConfig(titlePrompt),
            TITLE_GENERATION_TIMEOUT_MS,
            session.id
          );
          return normalizeGeneratedTitle(title);
        },
        getLatestTitle: () => this.deps.db.sessions.get(session.id)?.title ?? null,
        markAttempt: () => {
          this.deps.sessionTitleAttempts.add(session.id);
        },
        updateTitle: async (title) => {
          if (shouldAbort()) {
            log('[SessionTitle] Skip update: session no longer active', session.id);
            return false;
          }
          const updated = this.updateSessionTitle(session.id, title);
          if (updated) {
            session.title = title;
          }
          return updated;
        },
        shouldAbort,
        log,
      });
    } catch (error) {
      logError('[SessionTitle] Unexpected error', session.id, error);
    } finally {
      if (this.deps.titleGenerationTokens.get(session.id) === token) {
        this.deps.titleGenerationTokens.delete(session.id);
      }
    }
  }

  private updateSessionTitle(sessionId: string, title: string): boolean {
    if (!this.deps.db.sessions.get(sessionId)) {
      log('[SessionTitle] Skip title update for deleted session:', sessionId);
      return false;
    }
    this.deps.db.sessions.update(sessionId, { title });
    this.deps.sendToRenderer({
      type: 'session.update',
      payload: { sessionId, updates: { title } },
    });
    return true;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    sessionId: string
  ): Promise<T | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        logError('[SessionTitle] Generation timed out', { sessionId, timeoutMs });
        resolve(null);
      }, timeoutMs);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          logError('[SessionTitle] Generation rejected', { sessionId, error });
          resolve(null);
        });
    });
  }

  private async generateTitleWithConfig(titlePrompt: string): Promise<string | null> {
    return normalizeGeneratedTitle(
      await generateTitleWithClaudeSdk(titlePrompt, configStore.getAll())
    );
  }
}
