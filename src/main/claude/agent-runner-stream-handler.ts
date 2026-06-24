import { v4 as uuidv4 } from 'uuid';
import type { ContentBlock, Message, Session } from '../../renderer/types';
import { extractArtifactsFromText, buildArtifactTraceSteps } from '../utils/artifact-parser';
import { log, logCtx, logCtxError, logError, logWarn } from '../utils/logger';
import { mt } from '../i18n';
import {
  buildTerminalErrorEmissionDetails,
  buildTerminalErrorMessage,
  resolveAssistantStreamErrorText,
  resolveMessageEndPayload,
  toUserFacingErrorText,
} from './agent-runner-message-end';
import {
  LoopGuard,
  buildAbortUserMessage,
  buildHaltSteerMessage,
  buildWarnSteerMessage,
  type LoopGuardDecision,
  type ToolCallDescriptor,
} from './agent-runner-loop-guard';
import {
  normalizeTokenUsage,
  safeStringify,
  summarizeMessageForLog,
  toErrorText,
} from './agent-runner-mcp-bridge';
import { PreparedPiSessionRun } from './agent-runner-pi-setup';
import { AgentRunnerRunContext } from './agent-runner-run-context';
import { ThinkTagStreamParser } from './think-tag-parser';
import { normalizeToolExecutionResultForUi } from './tool-result-utils';
import {
  estimateTokensFromText,
  formatContextOverflowError,
  getLastInputTokenCount,
  shouldBlockForContextOverflow,
} from './context-budget';

export interface StreamHandlingResult {
  abortedByTimeout: boolean;
  abortedByLoopGuard: boolean;
  abortedByStreamError: boolean;
  terminalErrorText?: string;
  contextOverflowHandled: boolean;
}

interface RunPromptWithStreamHandlingOptions {
  ctx: AgentRunnerRunContext;
  session: Session;
  prompt: string;
  existingMessages: Message[];
  thinkingStepId: string;
  controller: AbortController;
  sanitizeOutputPaths(content: string): string;
  piSetup: PreparedPiSessionRun;
}

export async function runPromptWithStreamHandling({
  ctx,
  session,
  prompt,
  existingMessages,
  thinkingStepId,
  controller,
  sanitizeOutputPaths,
  piSetup,
}: RunPromptWithStreamHandlingOptions): Promise<StreamHandlingResult> {
  let streamedText = '';
  let compactionStepId: string | undefined;
  let hasEmittedError = false;
  let terminalErrorText: string | undefined;
  const thinkParser = new ThinkTagStreamParser();
  const promptStartedAt = Date.now();
  const streamEventCounts = new Map<string, number>();
  const loopGuard = new LoopGuard();
  let abortedByTimeout = false;
  let abortedByLoopGuard = false;
  let abortedByStreamError = false;

  const {
    piSession,
    provider,
    runtimeConfig,
    usedSyntheticModel,
    piModel,
    contextualPrompt,
    modelContextWindow,
    modelMaxTokens,
    thinkingLevel,
    promptPrefix,
    cachedSession,
    compactionEnabled,
  } = piSetup;

  const handleLoopGuardDecision = (decision: LoopGuardDecision, context: string): void => {
    if (decision.action === 'none' || controller.signal.aborted) {
      return;
    }
    logWarn(`[LoopGuard] ${context}: action=${decision.action} reason=${decision.reason}`);

    if (decision.action === 'hash_abort' || decision.action === 'freq_abort') {
      ctx.renderer.sendMessage(session.id, {
        id: uuidv4(),
        sessionId: session.id,
        role: 'assistant',
        content: [{ type: 'text', text: buildAbortUserMessage(decision) }],
        timestamp: Date.now(),
      });
      hasEmittedError = true;
      ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
        status: 'error',
        title: 'Stopped: tool-call loop detected',
      });
      try {
        abortedByLoopGuard = true;
        controller.abort();
      } catch (abortError) {
        logWarn('[LoopGuard] abort error:', abortError);
      }
      return;
    }

    const steerText =
      decision.action === 'hash_halt' || decision.action === 'freq_halt'
        ? buildHaltSteerMessage(decision)
        : buildWarnSteerMessage(decision);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sessionAny = piSession as any;
      if (typeof sessionAny.sendUserMessage === 'function') {
        Promise.resolve(sessionAny.sendUserMessage(steerText, { deliverAs: 'steer' })).catch(
          (error: unknown) => {
            logWarn('[LoopGuard] sendUserMessage(steer) failed:', error);
          }
        );
      } else {
        logWarn('[LoopGuard] piSession.sendUserMessage is not available; skipping steer');
      }
    } catch (error) {
      logWarn('[LoopGuard] sendUserMessage(steer) threw:', error);
    }
  };

  let ollamaColdStartTimerId: ReturnType<typeof setTimeout> | undefined;
  let receivedFirstStreamEvent = false;
  let firstStreamEventAt: number | undefined;

  if (provider === 'ollama') {
    ollamaColdStartTimerId = setTimeout(() => {
      if (!receivedFirstStreamEvent && !controller.signal.aborted) {
        ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
          title: 'Waiting for model to load into memory...',
        });
      }
    }, 10000);
  }

  const markFirstStreamEvent = (eventType: string) => {
    if (receivedFirstStreamEvent) {
      return;
    }
    receivedFirstStreamEvent = true;
    firstStreamEventAt = Date.now();
    if (ollamaColdStartTimerId) {
      clearTimeout(ollamaColdStartTimerId);
    }
    ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
      title: 'Processing request...',
    });
    if (provider === 'ollama') {
      log(
        '[ClaudeAgentRunner] Ollama first stream event received',
        safeStringify({
          sessionId: session.id,
          eventType,
          modelId: piModel.id,
          modelProvider: piModel.provider,
          baseUrl: piModel.baseUrl || runtimeConfig.baseUrl || '',
          latencyMs: firstStreamEventAt - promptStartedAt,
        })
      );
    }
  };

  const PROMPT_TIMEOUT_MS = 5 * 60 * 1000;
  let activityTimeoutId: ReturnType<typeof setTimeout> | undefined;
  const resetActivityTimeout = () => {
    if (activityTimeoutId) {
      clearTimeout(activityTimeoutId);
    }
    activityTimeoutId = setTimeout(() => {
      logWarn('[ClaudeAgentRunner] Prompt timed out (no activity for 5 min), aborting');
      abortedByTimeout = true;
      controller.abort();
    }, PROMPT_TIMEOUT_MS);
  };

  const recordStreamEvent = (eventType: string) => {
    streamEventCounts.set(eventType, (streamEventCounts.get(eventType) ?? 0) + 1);
  };

  const getStreamEventSummary = () =>
    Object.fromEntries(
      Array.from(streamEventCounts.entries()).sort(([left], [right]) => left.localeCompare(right))
    );

  const emitTerminalError = (
    errorText: string,
    options: { abort?: boolean; includePartialText?: boolean } = {}
  ): void => {
    terminalErrorText = errorText;
    let flushedThinking = '';
    let flushedText = '';

    if (options.includePartialText) {
      const flushed = thinkParser.flush();
      flushedThinking = flushed.thinking;
      flushedText = flushed.text;
    }

    const emission = buildTerminalErrorEmissionDetails({
      errorText,
      streamedText,
      flushedThinking,
      flushedText,
    });

    if (emission.thinkingDelta) {
      ctx.renderer.dispatch({
        type: 'stream.thinking',
        payload: { sessionId: session.id, delta: emission.thinkingDelta },
      });
    }
    if (emission.textDelta) {
      ctx.renderer.sendPartial(session.id, emission.textDelta);
    }

    const partialText = emission.partialText ? sanitizeOutputPaths(emission.partialText) : '';
    const messageText = buildTerminalErrorMessage(errorText, partialText);
    streamedText = '';
    ctx.renderer.dispatch({
      type: 'stream.partial',
      payload: { sessionId: session.id, delta: '' },
    });

    if (!hasEmittedError) {
      hasEmittedError = true;
      ctx.renderer.sendMessage(session.id, {
        id: uuidv4(),
        sessionId: session.id,
        role: 'assistant',
        content: [{ type: 'text', text: messageText }],
        timestamp: Date.now(),
      });
    }

    ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
      status: 'error',
      title: 'Request failed',
    });

    if (options.abort && !controller.signal.aborted) {
      try {
        abortedByStreamError = true;
        controller.abort();
      } catch (abortError) {
        logWarn('[ClaudeAgentRunner] stream-error abort failed:', abortError);
      }
    }
  };

  const lastInputTokens = getLastInputTokenCount(existingMessages);
  const memoryPrefixTokens = estimateTokensFromText(promptPrefix || '');
  const newPromptTokens = estimateTokensFromText(prompt);
  const projectedInputTokens = cachedSession
    ? lastInputTokens + newPromptTokens + memoryPrefixTokens
    : estimateTokensFromText(contextualPrompt);
  const contextWouldOverflow = shouldBlockForContextOverflow(
    cachedSession ? lastInputTokens : 0,
    cachedSession ? newPromptTokens + memoryPrefixTokens : projectedInputTokens,
    modelMaxTokens,
    modelContextWindow
  );

  if (contextWouldOverflow && !compactionEnabled) {
    const errorText = formatContextOverflowError(
      modelContextWindow,
      projectedInputTokens,
      modelMaxTokens
    );
    ctx.renderer.sendMessage(session.id, {
      id: uuidv4(),
      sessionId: session.id,
      role: 'assistant',
      content: [{ type: 'text', text: buildTerminalErrorMessage(errorText) }],
      timestamp: Date.now(),
    });
    ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
      status: 'error',
      title: 'Context full',
    });
    return {
      abortedByTimeout,
      abortedByLoopGuard,
      abortedByStreamError,
      terminalErrorText,
      contextOverflowHandled: true,
    };
  }

  if (contextWouldOverflow && compactionEnabled) {
    ctx.renderer.sendSessionNotice(session.id, mt('noticeCompactionStart'), 'info');
  }

  const unsubscribe = piSession.subscribe((event) => {
    try {
      if (controller.signal.aborted) {
        return;
      }

      resetActivityTimeout();

      if (event.type === 'message_update') {
        const updateType = event.assistantMessageEvent.type;
        recordStreamEvent(updateType);
        if (updateType !== 'text_delta' && updateType !== 'thinking_delta') {
          log(`[ClaudeAgentRunner] Event: ${event.type} → ${updateType}`);
        }
      } else if (event.type === 'message_start') {
        log(
          '[ClaudeAgentRunner] Event: message_start',
          safeStringify(summarizeMessageForLog(event.message), 2)
        );
      } else if (event.type === 'message_end') {
        log(
          '[ClaudeAgentRunner] Event: message_end',
          safeStringify(
            {
              message: summarizeMessageForLog(event.message),
              messageUpdateCounts: getStreamEventSummary(),
            },
            2
          )
        );
      } else if (event.type === 'turn_end') {
        log(`[ClaudeAgentRunner] Event: ${event.type}`);
      } else {
        log(`[ClaudeAgentRunner] Event: ${event.type}`);
      }

      switch (event.type) {
        case 'message_update': {
          if (controller.signal.aborted) {
            break;
          }
          const assistantMessageEvent = event.assistantMessageEvent;
          if (assistantMessageEvent.type === 'text_delta') {
            markFirstStreamEvent(assistantMessageEvent.type);
            const parsed = thinkParser.push(assistantMessageEvent.delta);
            if (parsed.thinking) {
              ctx.renderer.dispatch({
                type: 'stream.thinking',
                payload: { sessionId: session.id, delta: parsed.thinking },
              });
            }
            if (parsed.text) {
              streamedText += parsed.text;
              ctx.renderer.sendPartial(session.id, parsed.text);
            }
          } else if (assistantMessageEvent.type === 'thinking_delta') {
            markFirstStreamEvent(assistantMessageEvent.type);
            ctx.renderer.dispatch({
              type: 'stream.thinking',
              payload: { sessionId: session.id, delta: assistantMessageEvent.delta },
            });
          } else if (assistantMessageEvent.type === 'toolcall_start') {
            markFirstStreamEvent(assistantMessageEvent.type);
            const partial = assistantMessageEvent.partial;
            const toolContent = partial?.content?.[assistantMessageEvent.contentIndex];
            const toolName = toolContent?.type === 'toolCall' ? toolContent.name : 'unknown';
            const toolCallId = toolContent?.type === 'toolCall' ? toolContent.id : uuidv4();
            const toolDisplayName = ctx.getToolDisplayName(toolName);
            ctx.renderer.sendTraceStep(session.id, {
              id: toolCallId,
              type: 'tool_call',
              status: 'running',
              title: toolDisplayName,
              toolName,
              toolInput:
                toolContent?.type === 'toolCall'
                  ? (toolContent.arguments as Record<string, unknown>) || {}
                  : undefined,
              timestamp: Date.now(),
            });
          } else if (assistantMessageEvent.type === 'done') {
            log('[ClaudeAgentRunner] message_update done event (handled in message_end)');
          } else if (assistantMessageEvent.type === 'error') {
            markFirstStreamEvent(assistantMessageEvent.type);
            const errorDetail = JSON.stringify(
              assistantMessageEvent.error?.content || 'no content'
            );
            logCtxError(
              '[ClaudeAgentRunner] pi-ai stream error:',
              assistantMessageEvent.reason,
              errorDetail
            );
            emitTerminalError(resolveAssistantStreamErrorText(assistantMessageEvent), {
              abort: true,
              includePartialText: true,
            });
          }
          break;
        }

        case 'message_end': {
          if (controller.signal.aborted) {
            break;
          }

          const flushed = thinkParser.flush();
          if (flushed.thinking) {
            ctx.renderer.dispatch({
              type: 'stream.thinking',
              payload: { sessionId: session.id, delta: flushed.thinking },
            });
          }
          if (flushed.text) {
            streamedText += flushed.text;
            ctx.renderer.sendPartial(session.id, flushed.text);
          }

          const message = event.message;
          if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === '1') {
            log('[ClaudeAgentRunner] message_end raw message:', safeStringify(message, 2));
          }
          const resolvedPayload = resolveMessageEndPayload({
            message: message as Parameters<typeof resolveMessageEndPayload>[0]['message'],
            streamedText,
          });
          streamedText = resolvedPayload.nextStreamedText;

          if (provider === 'ollama') {
            log(
              '[ClaudeAgentRunner] Ollama message_end diagnostics',
              safeStringify({
                sessionId: session.id,
                modelId: piModel.id,
                modelProvider: piModel.provider,
                usedSyntheticModel,
                receivedFirstStreamEvent,
                firstStreamLatencyMs: firstStreamEventAt
                  ? firstStreamEventAt - promptStartedAt
                  : null,
                stopReason: (message as { stopReason?: unknown })?.stopReason ?? null,
                contentBlocks: Array.isArray((message as { content?: unknown[] })?.content)
                  ? ((message as { content?: unknown[] }).content?.length ?? 0)
                  : 0,
                emittedError: Boolean(resolvedPayload.errorText),
              })
            );
          }

          if (resolvedPayload.errorText) {
            emitTerminalError(resolvedPayload.errorText, { includePartialText: true });
            break;
          }
          if (!resolvedPayload.shouldEmitMessage) {
            break;
          }

          const contentBlocks: ContentBlock[] = [];
          for (const block of resolvedPayload.effectiveContent) {
            if (block.type === 'text') {
              const { cleanText, artifacts } = extractArtifactsFromText(block.text);
              if (cleanText) {
                contentBlocks.push({ type: 'text', text: sanitizeOutputPaths(cleanText) });
              }
              if (artifacts.length > 0) {
                for (const step of buildArtifactTraceSteps(artifacts)) {
                  ctx.renderer.sendTraceStep(session.id, step);
                }
              }
            } else if (block.type === 'toolCall') {
              contentBlocks.push({
                type: 'tool_use',
                id: block.id,
                name: block.name,
                displayName: ctx.getToolDisplayName(block.name),
                input: block.arguments,
              });
            } else if (block.type === 'thinking') {
              contentBlocks.push({ type: 'thinking', thinking: block.thinking });
            } else {
              const unknownBlock = block as { type?: string; text?: string };
              log(`[ClaudeAgentRunner] Unknown content block type: ${unknownBlock.type}`);
              const text = unknownBlock.text || JSON.stringify(block);
              if (text) {
                contentBlocks.push({ type: 'text', text });
              }
            }
          }

          ctx.renderer.dispatch({
            type: 'stream.partial',
            payload: { sessionId: session.id, delta: '' },
          });

          const toolUseDescriptors: ToolCallDescriptor[] = [];
          for (const block of resolvedPayload.effectiveContent) {
            if (block.type === 'toolCall') {
              toolUseDescriptors.push({
                name: block.name || '',
                input: (block.arguments as Record<string, unknown>) || undefined,
              });
            }
          }
          if (toolUseDescriptors.length > 0) {
            handleLoopGuardDecision(
              loopGuard.recordAssistantMessage(toolUseDescriptors),
              'message_end'
            );
            if (controller.signal.aborted) {
              break;
            }
          }

          if (contentBlocks.length > 0) {
            const messageWithUsage = message as { usage?: unknown };
            const tokenUsage = normalizeTokenUsage(messageWithUsage.usage);
            if (messageWithUsage.usage) {
              log(
                '[ClaudeAgentRunner] normalized usage:',
                safeStringify({ raw: messageWithUsage.usage, normalized: tokenUsage }, 2)
              );
            }
            ctx.renderer.sendMessage(session.id, {
              id: uuidv4(),
              sessionId: session.id,
              role: 'assistant',
              content: contentBlocks,
              timestamp: Date.now(),
              api: piModel.api,
              provider: piModel.provider,
              model: piModel.id,
              tokenUsage,
            });
          }
          break;
        }

        case 'tool_execution_start':
          logCtx(`[ClaudeAgentRunner] Tool execution start: ${event.toolName}`);
          handleLoopGuardDecision(
            loopGuard.recordToolInvocation(event.toolName),
            'tool_execution_start'
          );
          break;

        case 'tool_execution_end': {
          if (controller.signal.aborted) {
            break;
          }
          const normalizedToolResult = normalizeToolExecutionResultForUi(event.result);
          const outputText = normalizedToolResult.content;
          const toolDisplayName = ctx.getToolDisplayName(event.toolName);
          ctx.renderer.sendTraceUpdate(session.id, event.toolCallId, {
            status: event.isError ? 'error' : 'completed',
            title: toolDisplayName,
            toolName: event.toolName,
            toolOutput: sanitizeOutputPaths(outputText).slice(0, 800),
          });

          ctx.renderer.sendMessage(session.id, {
            id: uuidv4(),
            sessionId: session.id,
            role: 'assistant',
            content: [
              {
                type: 'tool_result',
                toolUseId: event.toolCallId,
                content: sanitizeOutputPaths(outputText),
                isError: event.isError,
                ...(normalizedToolResult.images.length > 0
                  ? { images: normalizedToolResult.images }
                  : {}),
              },
            ],
            timestamp: Date.now(),
          });
          break;
        }

        case 'agent_end':
          logCtx('[ClaudeAgentRunner] Agent finished');
          break;

        case 'compaction_start':
          log('[ClaudeAgentRunner] Auto-compaction started, reason:', event.reason);
          ctx.renderer.sendSessionNotice(session.id, mt('noticeCompactionStart'), 'info');
          compactionStepId = `compaction-${Date.now()}`;
          ctx.renderer.sendTraceStep(session.id, {
            id: compactionStepId,
            type: 'thinking',
            status: 'running',
            title: `Compacting context (${event.reason})...`,
            timestamp: Date.now(),
          });
          break;

        case 'compaction_end': {
          const status = event.aborted || event.errorMessage ? 'error' : 'completed';
          const title = event.aborted
            ? 'Context compaction aborted'
            : event.errorMessage
              ? `Context compaction failed: ${event.errorMessage}`
              : 'Context compaction completed';
          log('[ClaudeAgentRunner] Auto-compaction ended:', title, 'willRetry:', event.willRetry);
          if (compactionStepId) {
            ctx.renderer.sendTraceUpdate(session.id, compactionStepId, { status, title });
            compactionStepId = undefined;
          } else {
            ctx.renderer.sendTraceStep(session.id, {
              id: `compaction-end-${Date.now()}`,
              type: 'thinking',
              status,
              title,
              timestamp: Date.now(),
            });
          }
          if (event.aborted) {
            ctx.renderer.sendSessionNotice(
              session.id,
              mt('noticeCompactionFailed', { error: title }),
              'warning'
            );
          } else if (event.errorMessage) {
            ctx.renderer.sendSessionNotice(
              session.id,
              mt('noticeCompactionFailed', { error: event.errorMessage }),
              'warning'
            );
          } else {
            ctx.renderer.sendSessionNotice(session.id, mt('noticeCompactionCompleted'), 'success');
          }
          break;
        }
      }
    } catch (subscribeError) {
      logError('[ClaudeAgentRunner] Error in subscribe callback:', subscribeError);
      if (compactionStepId) {
        ctx.renderer.sendTraceUpdate(session.id, compactionStepId, {
          status: 'error',
          title: 'Error during context compaction',
        });
        compactionStepId = undefined;
      }
      if (!hasEmittedError) {
        hasEmittedError = true;
        const errorText = toUserFacingErrorText(toErrorText(subscribeError));
        ctx.renderer.sendMessage(session.id, {
          id: uuidv4(),
          sessionId: session.id,
          role: 'assistant',
          content: [{ type: 'text', text: `**Error**: ${errorText}` }],
          timestamp: Date.now(),
        });
      }
    }
  });

  try {
    resetActivityTimeout();
    if (provider === 'ollama') {
      log(
        '[ClaudeAgentRunner] Starting Ollama prompt',
        safeStringify({
          sessionId: session.id,
          modelId: piModel.id,
          modelProvider: piModel.provider,
          baseUrl: piModel.baseUrl || runtimeConfig.baseUrl || '',
          usedSyntheticModel,
          hasExplicitApiKey: Boolean(runtimeConfig.apiKey?.trim()),
          thinkingLevel,
        })
      );
    }
    const promptResult = await piSession.prompt(contextualPrompt);
    log(
      '[ClaudeAgentRunner] prompt() returned:',
      JSON.stringify(promptResult ?? 'void').substring(0, 1000)
    );
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'AbortError') {
      throw error;
    }
  } finally {
    try {
      unsubscribe();
    } catch (error) {
      logWarn('[ClaudeAgentRunner] unsubscribe error:', error);
    }
    if (activityTimeoutId) {
      clearTimeout(activityTimeoutId);
    }
    if (ollamaColdStartTimerId) {
      clearTimeout(ollamaColdStartTimerId);
    }
  }

  return {
    abortedByTimeout,
    abortedByLoopGuard,
    abortedByStreamError,
    terminalErrorText,
    contextOverflowHandled: false,
  };
}
