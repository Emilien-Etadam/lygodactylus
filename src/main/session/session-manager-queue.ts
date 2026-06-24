import { v4 as uuidv4 } from 'uuid';
import type {
  ContentBlock,
  FileAttachmentContent,
  Message,
  ServerEvent,
  Session,
  SessionStatus,
  TextContent,
} from '../../renderer/types';
import { configStore } from '../config/config-store';
import type { AgentRuntimeExtensionManager } from '../extensions/agent-runtime-extension-manager';
import {
  generateTraceId,
  log,
  logCtx,
  logCtxError,
  logError,
  runWithLogContext,
} from '../utils/logger';

export interface SessionManagerAgentRunner {
  run(session: Session, prompt: string, existingMessages: Message[]): Promise<void>;
}

export interface PromptQueueItem {
  prompt: string;
  content?: ContentBlock[];
}

export type PromptQueues = Map<string, PromptQueueItem[]>;

interface QueueRuntime {
  activeSessions: Map<string, AbortController>;
  promptQueues: PromptQueues;
  processQueue(session: Session): Promise<void>;
  processPrompt(session: Session, prompt: string, content?: ContentBlock[]): Promise<void>;
  loadSession(sessionId: string): Session | null;
  updateSessionStatus(sessionId: string, status: SessionStatus): void;
}

export interface ProcessPromptOptions {
  session: Session;
  prompt: string;
  content?: ContentBlock[];
  agentRunner: SessionManagerAgentRunner;
  extensionManager?: AgentRuntimeExtensionManager;
  ensureSandboxInitialized(session: Session): Promise<void>;
  processFileAttachments(session: Session, content: ContentBlock[]): Promise<ContentBlock[]>;
  getMessages(sessionId: string): Message[];
  saveMessage(message: Message): void;
  updateSessionModel(session: Session, model: string): void;
  sendToRenderer(event: ServerEvent): void;
  runSessionTitleGeneration(
    session: Session,
    prompt: string,
    existingMessages: Message[]
  ): Promise<void>;
}

export function enqueuePrompt(
  runtime: QueueRuntime,
  session: Session,
  prompt: string,
  content?: ContentBlock[]
): void {
  const queue = runtime.promptQueues.get(session.id) || [];
  queue.push({ prompt, content });
  runtime.promptQueues.set(session.id, queue);

  if (!runtime.activeSessions.has(session.id)) {
    runtime.processQueue(session).catch((error) => {
      logError('[SessionManager] Queue processing error:', error);
    });
  } else {
    log('[SessionManager] Session running, queued prompt:', session.id);
  }
}

export async function processQueue(runtime: QueueRuntime, initialSession: Session): Promise<void> {
  if (runtime.activeSessions.has(initialSession.id)) {
    return;
  }

  const controller = new AbortController();
  runtime.activeSessions.set(initialSession.id, controller);
  runtime.updateSessionStatus(initialSession.id, 'running');

  let session = initialSession;
  try {
    let shouldContinue = true;
    while (shouldContinue) {
      while (!controller.signal.aborted) {
        const queue = runtime.promptQueues.get(session.id);
        if (!queue || queue.length === 0) {
          break;
        }

        const item = queue.shift();
        if (!item) {
          continue;
        }

        const latestSession = runtime.loadSession(session.id);
        if (!latestSession) {
          log('[SessionManager] Session removed while processing queue:', session.id);
          return;
        }

        await runtime.processPrompt(latestSession, item.prompt, item.content);
        if (controller.signal.aborted) {
          return;
        }
      }

      if (controller.signal.aborted) {
        shouldContinue = false;
        continue;
      }

      const pendingQueue = runtime.promptQueues.get(session.id);
      if (!pendingQueue || pendingQueue.length === 0) {
        shouldContinue = false;
        continue;
      }

      const latestSession = runtime.loadSession(session.id);
      if (!latestSession) {
        runtime.promptQueues.delete(session.id);
        shouldContinue = false;
        continue;
      }

      session = latestSession;
      log('[SessionManager] Continuing queue with newly arrived prompts:', session.id);
    }
  } finally {
    runtime.activeSessions.delete(session.id);
    const queue = runtime.promptQueues.get(session.id);
    if (queue && queue.length === 0) {
      runtime.promptQueues.delete(session.id);
    }
    runtime.updateSessionStatus(session.id, 'idle');
  }
}

export async function processPrompt(options: ProcessPromptOptions): Promise<void> {
  const { session, prompt, content } = options;
  const traceId = generateTraceId();

  return runWithLogContext({ sessionId: session.id, traceId }, async () => {
    logCtx('[SessionManager] Processing prompt for session:', session.id, 'traceId:', traceId);
    logCtx(
      '[SessionManager] Received content:',
      content
        ? JSON.stringify(
            content.map((block) => ({
              type: block.type,
              hasData: !!(block as { source?: { data?: unknown } }).source?.data,
            }))
          )
        : 'none'
    );

    await options.ensureSandboxInitialized(session);

    try {
      let messageContent: ContentBlock[] =
        content && content.length > 0 ? content : [{ type: 'text', text: prompt } as TextContent];

      messageContent = await options.processFileAttachments(session, messageContent);

      logCtx(
        '[SessionManager] Final message content types:',
        messageContent.map((block) => block.type)
      );

      let enhancedPrompt = prompt;
      const fileAttachments = messageContent.filter(
        (block) => block.type === 'file_attachment'
      ) as FileAttachmentContent[];
      if (fileAttachments.length > 0) {
        const fileInfo = fileAttachments
          .map(
            (file) =>
              `- ${file.filename} (${(file.size / 1024).toFixed(1)} KB) at path: ${file.relativePath}`
          )
          .join('\n');
        enhancedPrompt = `${prompt}\n\n[Attached files - use Read tool to access them]:\n${fileInfo}`;
        logCtx('[SessionManager] Enhanced prompt with file info:', enhancedPrompt);
      }

      const existingMessages = options.getMessages(session.id);
      const userMessage: Message = {
        id: uuidv4(),
        sessionId: session.id,
        role: 'user',
        content: messageContent,
        timestamp: Date.now(),
      };
      options.saveMessage(userMessage);
      logCtx(
        '[SessionManager] User message saved:',
        userMessage.id,
        'with',
        messageContent.length,
        'content blocks'
      );

      const messagesForContext = [...existingMessages, userMessage];
      const currentModel = configStore.get('model');
      if (currentModel && currentModel !== session.model) {
        options.updateSessionModel(session, currentModel);
      }

      await options.agentRunner.run(session, enhancedPrompt, messagesForContext);

      if (options.extensionManager) {
        const stableMessages = options.getMessages(session.id);
        options.extensionManager
          .afterSessionRun({
            session,
            prompt: enhancedPrompt,
            messages: stableMessages,
          })
          .catch((error) =>
            logCtxError('[SessionManager] Runtime extension post-run hook failed:', error)
          );
      }

      options
        .runSessionTitleGeneration(session, prompt, existingMessages)
        .catch((error) => logCtxError('[SessionManager] Title generation failed:', error));
    } catch (error) {
      logCtxError('[SessionManager] Error processing prompt:', error);
      const errorText = error instanceof Error ? error.message : 'Unknown error';
      const alreadyReportedToUser = Boolean(
        error &&
        typeof error === 'object' &&
        (error as { alreadyReportedToUser?: boolean }).alreadyReportedToUser
      );

      if (!alreadyReportedToUser) {
        const assistantMessage: Message = {
          id: uuidv4(),
          sessionId: session.id,
          role: 'assistant',
          content: [{ type: 'text', text: `**Error**: ${errorText}` }],
          timestamp: Date.now(),
        };
        options.saveMessage(assistantMessage);
        options.sendToRenderer({
          type: 'stream.message',
          payload: { sessionId: session.id, message: assistantMessage },
        });
      }

      options.sendToRenderer({
        type: 'error',
        payload: { message: errorText },
      });
    }
  });
}
