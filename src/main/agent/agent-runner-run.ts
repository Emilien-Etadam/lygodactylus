import { v4 as uuidv4 } from 'uuid';
import { setMaxListeners } from 'node:events';
import {
  createBashToolDefinition,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { Message, Session } from '../../renderer/types';
import {
  bumpAutonomousIteration,
  decideAutonomousLoop,
  getAutonomousIteration,
  resetAutonomousIteration,
  runConfiguredQualityCommands,
} from '../autonomy/autonomous-loop';
import { clearCarefulAllowRun } from '../autonomy/careful-run-allow';
import { listConfiguredCommands } from '../autonomy/workspace-tooling';
import { getWorkspaceTooling } from '../autonomy/workspace-tooling';
import { checkpointService } from '../checkpoints';
import { configStore } from '../config/config-store';
import { getSandboxAdapter } from '../sandbox/sandbox-adapter';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { normalizeSessionAutonomy } from '../../shared/session-autonomy';
import { log, logCtx, logCtxError, logError, logTiming } from '../utils/logger';
import {
  resolveAbortDisposition,
  shouldPreserveExistingTrace,
  toUserFacingErrorText,
} from './agent-runner-message-end';
import { bootstrapSandboxEnvironment } from './agent-runner-sandbox-bootstrap';
import { preparePiSessionRun } from './agent-runner-pi-setup';
import {
  type AgentRunnerRunContext,
  VIRTUAL_WORKSPACE_PATH,
  sendTimeoutMessage,
} from './agent-runner-run-context';
export { type AgentRunnerRunContext } from './agent-runner-run-context';
import { runPromptWithStreamHandling } from './agent-runner-stream-handler';
import { withAsyncTimeout } from '../utils/async-timeout';

const AUTONOMOUS_FIX_PROMPT_PREFIX = 'Automatic quality check failed';

const PI_SESSION_SETUP_TIMEOUT_MS = 180_000;

export async function executeAgentRun(
  ctx: AgentRunnerRunContext,
  session: Session,
  prompt: string,
  existingMessages: Message[]
): Promise<void> {
  const runStartTime = Date.now();
  logCtx('[AgentRunner] run() started');

  const controller = new AbortController();
  try {
    // The SDK attaches many listeners on the same AbortSignal; raise the cap to avoid noisy warnings.
    setMaxListeners(0, controller.signal);
  } catch {
    // Older runtimes that cannot adjust EventTarget listener limits can be ignored.
  }
  ctx.activeControllers.set(session.id, controller);
  checkpointService.markSessionRunning(session.id, true);
  clearCarefulAllowRun(session.id);
  // Fresh user turns reset the autonomous fix counter; follow-up fix prompts keep it.
  if (!prompt.startsWith(AUTONOMOUS_FIX_PROMPT_PREFIX)) {
    resetAutonomousIteration(session.id);
  }

  let sandboxPath: string | null = null;
  let useSandboxIsolation = false;
  let sandboxPathRegex: RegExp | null = null;
  let runCompletedOk = false;
  const sanitizeOutputPaths = (content: string): string => {
    if (!sandboxPath || !useSandboxIsolation) return content;
    if (!sandboxPathRegex) {
      sandboxPathRegex = new RegExp(sandboxPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    }
    return content.replace(sandboxPathRegex, VIRTUAL_WORKSPACE_PATH);
  };

  const thinkingStepId = uuidv4();
  const checkpointRunId = uuidv4();
  let checkpointStarted = false;

  try {
    ctx.pathResolver.registerSession(session.id, session.mountedPaths);
    logTiming('pathResolver.registerSession', runStartTime);

    ctx.renderer.sendTraceStep(session.id, {
      id: thinkingStepId,
      type: 'thinking',
      status: 'running',
      title: 'Processing request...',
      timestamp: Date.now(),
    });
    logTiming('sendTraceStep (thinking)', runStartTime);

    const workingDir = session.cwd || undefined;
    logCtx('[AgentRunner] Working directory:', workingDir || '(none)');

    const sandbox = getSandboxAdapter();
    const sandboxEnabled = configStore.get('sandboxEnabled') !== false;
    const sandboxBootstrap = await bootstrapSandboxEnvironment({
      sessionId: session.id,
      workingDir,
      thinkingStepId,
      sandboxEnabled,
      sandbox,
      sendToRenderer: (event) => ctx.renderer.dispatch(event),
      sendMessage: (sessionId, message) => ctx.renderer.sendMessage(sessionId, message),
      sendTraceUpdate: (sessionId, stepId, updates) =>
        ctx.renderer.sendTraceUpdate(sessionId, stepId, updates),
      getBuiltinSkillsPath: () => ctx.skillsPaths.getBuiltinSkillsPath(),
      getRuntimeSkillsDir: () => ctx.skillsPaths.getRuntimeSkillsDir(),
      syncUserSkillsToAppDir: (appSkillsDir) =>
        ctx.skillsPaths.syncUserSkillsToAppDir(appSkillsDir),
      syncConfiguredSkillsToRuntimeDir: (runtimeSkillsDir) =>
        ctx.skillsPaths.syncConfiguredSkillsToRuntimeDir(runtimeSkillsDir),
    });
    if (sandboxBootstrap.aborted) {
      return;
    }
    sandboxPath = sandboxBootstrap.sandboxPath;
    useSandboxIsolation = sandboxBootstrap.useSandboxIsolation;
    const piSetup = await withAsyncTimeout('preparePiSessionRun', PI_SESSION_SETUP_TIMEOUT_MS, () =>
      preparePiSessionRun({
        ctx,
        session,
        prompt,
        existingMessages,
        workingDir,
        sandboxPath,
        useSandboxIsolation,
        sandbox,
        runStartTime,
      })
    );

    const checkpointWorkspaceRoot = piSetup.effectiveCwd || workingDir || session.cwd || '';
    if (checkpointWorkspaceRoot) {
      checkpointService.startRun(session.id, checkpointRunId, checkpointWorkspaceRoot);
      checkpointStarted = true;
    }

    const streamResult = await runPromptWithStreamHandling({
      ctx,
      session,
      prompt,
      existingMessages,
      thinkingStepId,
      controller,
      sanitizeOutputPaths,
      piSetup,
    });
    if (streamResult.contextOverflowHandled) {
      return;
    }

    logTiming('agent prompt completed', runStartTime);

    const abortDisposition = resolveAbortDisposition({
      abortedByTimeout: streamResult.abortedByTimeout,
      abortedByLoopGuard: streamResult.abortedByLoopGuard,
      abortedByStreamError: streamResult.abortedByStreamError,
    });
    if (controller.signal.aborted && streamResult.abortedByTimeout) {
      logCtx('[AgentRunner] Aborted due to timeout (detected after prompt returned)');
      sendTimeoutMessage(ctx, session.id, thinkingStepId);
      return;
    }
    if (controller.signal.aborted && shouldPreserveExistingTrace(abortDisposition)) {
      logCtx(
        `[AgentRunner] Aborted by ${abortDisposition === 'loop_guard' ? 'loop guard' : 'stream error'} (detected after prompt returned)`
      );
      return;
    }
    if (controller.signal.aborted) {
      logCtx('[AgentRunner] Aborted by user');
      ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
        status: 'completed',
        title: 'Cancelled',
      });
      return;
    }
    ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
      status: streamResult.terminalErrorText ? 'error' : 'completed',
      title: streamResult.terminalErrorText ? 'Request failed' : 'Task completed',
    });
    runCompletedOk = !streamResult.terminalErrorText;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logCtx('[AgentRunner] Aborted by user');
      ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
        status: 'completed',
        title: 'Cancelled',
      });
    } else {
      logCtxError('[AgentRunner] Error:', error);

      const errorText = toUserFacingErrorText(
        error instanceof Error ? error.message : String(error)
      );
      const errorMsg: Message = {
        id: uuidv4(),
        sessionId: session.id,
        role: 'assistant',
        content: [{ type: 'text', text: `**Error**: ${errorText}` }],
        timestamp: Date.now(),
      };
      ctx.renderer.sendMessage(session.id, errorMsg);

      ctx.renderer.sendTraceStep(session.id, {
        id: uuidv4(),
        type: 'thinking',
        status: 'error',
        title: 'Error occurred',
        timestamp: Date.now(),
      });

      if (error instanceof Error) {
        (error as Error & { alreadyReportedToUser?: boolean }).alreadyReportedToUser = true;
      }
    }
  } finally {
    ctx.activeControllers.delete(session.id);
    checkpointService.markSessionRunning(session.id, false);
    clearCarefulAllowRun(session.id);

    let filesModified = false;
    if (checkpointStarted) {
      try {
        const summary = await checkpointService.endRun(session.id, checkpointRunId);
        if (summary && summary.files.length > 0) {
          filesModified = true;
          ctx.renderer.dispatch({
            type: 'checkpoint.runReady',
            payload: {
              sessionId: session.id,
              runId: summary.runId,
              messageIds: summary.messageIds,
              partialCoverage: summary.partialCoverage,
              files: summary.files,
            },
          });
        }
      } catch (checkpointErr) {
        logError('[AgentRunner] Checkpoint endRun failed:', checkpointErr);
      }
    }
    ctx.pathResolver.unregisterSession(session.id);

    if (useSandboxIsolation && sandboxPath) {
      try {
        const sandbox = getSandboxAdapter();

        if (sandbox.isWSL) {
          log('[AgentRunner] Syncing sandbox changes to Windows...');
          const syncResult = await SandboxSync.syncToWindows(session.id);
          if (syncResult.success) {
            log('[AgentRunner] Sync completed successfully');
          } else {
            logError('[AgentRunner] Sync failed:', syncResult.error);
          }
        } else if (sandbox.isLima) {
          log('[AgentRunner] Syncing sandbox changes to macOS...');
          const { LimaSync } = await import('../sandbox/lima-sync');
          const syncResult = await LimaSync.syncToMac(session.id);
          if (syncResult.success) {
            log('[AgentRunner] Sync completed successfully');
          } else {
            logError('[AgentRunner] Sync failed:', syncResult.error);
          }
        }
      } catch (syncErr) {
        logError('[AgentRunner] Sandbox sync error:', syncErr);
        ctx.renderer.sendMessage(session.id, {
          id: uuidv4(),
          sessionId: session.id,
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: `**Warning**: Sandbox sync failed: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`,
            },
          ],
          timestamp: Date.now(),
        });
      }
    }

    // Autonomous lint/test loop — after sync so host cwd reflects mutations.
    try {
      await maybeRunAutonomousQualityLoop({
        ctx,
        session,
        runCompletedOk,
        filesModified,
      });
    } catch (autonomousErr) {
      logError('[AgentRunner] Autonomous quality loop failed:', autonomousErr);
    }
  }
}

async function maybeRunAutonomousQualityLoop(options: {
  ctx: AgentRunnerRunContext;
  session: Session;
  runCompletedOk: boolean;
  filesModified: boolean;
}): Promise<void> {
  const { ctx, session, runCompletedOk, filesModified } = options;
  if (!runCompletedOk) {
    return;
  }
  // Live autonomy (not the session snapshot from run start / prep).
  const autonomy =
    ctx.getSessionAutonomy?.(session.id) ?? normalizeSessionAutonomy(session.autonomy);
  if (autonomy !== 'autonomous') {
    return;
  }

  const tooling = getWorkspaceTooling(session.cwd);
  const configured = listConfiguredCommands(tooling);
  if (configured.length === 0) {
    return;
  }
  if (!filesModified) {
    resetAutonomousIteration(session.id);
    return;
  }

  const cwd = session.cwd || process.cwd();
  const bashTool = createBashToolDefinition(cwd) as ToolDefinition;
  const { results } = await runConfiguredQualityCommands(bashTool, session.cwd);
  const decision = decideAutonomousLoop({
    sessionId: session.id,
    filesModified: true,
    commandsConfigured: true,
    results,
    currentIteration: getAutonomousIteration(session.id),
  });

  if (decision.action === 'stop') {
    resetAutonomousIteration(session.id);
    return;
  }

  if (decision.action === 'summary' && decision.summaryText) {
    resetAutonomousIteration(session.id);
    ctx.renderer.sendMessage(session.id, {
      id: uuidv4(),
      sessionId: session.id,
      role: 'assistant',
      content: [{ type: 'text', text: decision.summaryText }],
      timestamp: Date.now(),
    });
    return;
  }

  if (decision.action === 'retry' && decision.fixPrompt && ctx.enqueueFollowUpPrompt) {
    bumpAutonomousIteration(session.id);
    ctx.enqueueFollowUpPrompt(session.id, decision.fixPrompt);
    log(
      `[AgentRunner] Autonomous fix queued (iteration ${decision.iteration}) for ${session.id}`
    );
  }
}
