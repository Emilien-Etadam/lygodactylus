/**
 * Autonomous post-run lint/test loop.
 * Pure helpers + command execution via the bash tool pipeline.
 */
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import {
  AUTONOMOUS_MAX_ITERATIONS,
  AUTONOMOUS_OUTPUT_TRUNCATE_BYTES,
} from '../../shared/session-autonomy';
import { log, logWarn } from '../utils/logger';
import { truncateUtf8 } from './unified-diff';
import {
  getWorkspaceTooling,
  listConfiguredCommands,
  type WorkspaceToolingCommands,
} from './workspace-tooling';

export interface AutonomousCommandResult {
  kind: 'lint' | 'test';
  command: string;
  exitCode: number;
  output: string;
  ok: boolean;
}

export interface AutonomousLoopDecision {
  action: 'stop' | 'retry' | 'summary';
  iteration: number;
  results: AutonomousCommandResult[];
  /** User-facing prompt to enqueue when action === 'retry'. */
  fixPrompt?: string;
  /** Assistant summary when action === 'summary' (max iterations reached). */
  summaryText?: string;
}

/** In-memory iteration counter per session (reset on non-autonomous / success / stop). */
const iterationBySession = new Map<string, number>();

export function getAutonomousIteration(sessionId: string): number {
  return iterationBySession.get(sessionId) ?? 0;
}

export function resetAutonomousIteration(sessionId: string): void {
  iterationBySession.delete(sessionId);
}

export function bumpAutonomousIteration(sessionId: string): number {
  const next = getAutonomousIteration(sessionId) + 1;
  iterationBySession.set(sessionId, next);
  return next;
}

export function buildFixPrompt(results: AutonomousCommandResult[], iteration: number): string {
  const blocks = results
    .filter((r) => !r.ok)
    .map(
      (r) =>
        `### ${r.kind} (\`${r.command}\`) — exit ${r.exitCode}\n\`\`\`\n${r.output}\n\`\`\``
    )
    .join('\n\n');
  return [
    `Automatic quality check failed (iteration ${iteration}/${AUTONOMOUS_MAX_ITERATIONS}).`,
    'Please fix these errors, then stop when checks would pass.',
    '',
    blocks,
  ].join('\n');
}

export function buildMaxIterationSummary(
  results: AutonomousCommandResult[],
  iteration: number
): string {
  const failed = results.filter((r) => !r.ok).map((r) => r.kind);
  return [
    `**Autonomous mode stopped** after ${iteration}/${AUTONOMOUS_MAX_ITERATIONS} fix iterations.`,
    failed.length > 0
      ? `Still failing: ${failed.join(', ')}.`
      : 'Checks did not complete successfully.',
    'You can fix manually or undo the run via checkpoints.',
  ].join(' ');
}

/**
 * Decide next autonomous action given whether the run modified files and command results.
 * Pure — no I/O. Used by tests and the runner.
 */
export function decideAutonomousLoop(options: {
  sessionId: string;
  filesModified: boolean;
  commandsConfigured: boolean;
  results: AutonomousCommandResult[];
  /** Current iteration count BEFORE this decision (0 = first post-run check). */
  currentIteration: number;
}): AutonomousLoopDecision {
  const { filesModified, commandsConfigured, results, currentIteration } = options;

  if (!filesModified || !commandsConfigured) {
    return { action: 'stop', iteration: currentIteration, results };
  }

  const allOk = results.length > 0 && results.every((r) => r.ok);
  if (allOk) {
    return { action: 'stop', iteration: currentIteration, results };
  }

  // A failed check after a mutating run counts as one iteration toward the ceiling.
  const nextIteration = currentIteration + 1;
  if (nextIteration > AUTONOMOUS_MAX_ITERATIONS) {
    return {
      action: 'summary',
      iteration: AUTONOMOUS_MAX_ITERATIONS,
      results,
      summaryText: buildMaxIterationSummary(results, AUTONOMOUS_MAX_ITERATIONS),
    };
  }

  return {
    action: 'retry',
    iteration: nextIteration,
    results,
    fixPrompt: buildFixPrompt(results, nextIteration),
  };
}

function extractTextFromToolResult(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return '';
  }
  const record = result as {
    content?: Array<{ type?: string; text?: string }>;
    details?: { exitCode?: number; stdout?: string; stderr?: string };
  };
  const parts: string[] = [];
  if (Array.isArray(record.content)) {
    for (const block of record.content) {
      if (block && block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
  }
  if (record.details) {
    if (typeof record.details.stdout === 'string' && record.details.stdout) {
      parts.push(record.details.stdout);
    }
    if (typeof record.details.stderr === 'string' && record.details.stderr) {
      parts.push(record.details.stderr);
    }
  }
  return parts.join('\n');
}

function extractExitCode(result: unknown): number {
  if (!result || typeof result !== 'object') {
    return 1;
  }
  const details = (result as { details?: { exitCode?: number } }).details;
  if (details && typeof details.exitCode === 'number') {
    return details.exitCode;
  }
  // Heuristic: tool text often includes exit code; treat non-empty error-ish as fail.
  const text = extractTextFromToolResult(result).toLowerCase();
  if (text.includes('exit code 0') || text.includes('exit_code: 0')) {
    return 0;
  }
  if (
    text.includes('exit code') ||
    text.includes('command failed') ||
    text.includes('error:')
  ) {
    return 1;
  }
  // If the tool returned without throwing, assume success when no exit code.
  return 0;
}

/**
 * Run configured lint/test commands via a bash ToolDefinition (same pipeline as the agent).
 */
export async function runConfiguredQualityCommands(
  bashTool: ToolDefinition | undefined,
  cwd: string | undefined,
  signal?: AbortSignal
): Promise<{ commands: WorkspaceToolingCommands; results: AutonomousCommandResult[] }> {
  const commands = getWorkspaceTooling(cwd);
  const configured = listConfiguredCommands(commands);
  if (!bashTool || configured.length === 0) {
    return { commands, results: [] };
  }

  const results: AutonomousCommandResult[] = [];
  for (const { kind, command } of configured) {
    if (signal?.aborted) {
      break;
    }
    try {
      const raw = await bashTool.execute(
        `autonomous-${kind}`,
        { command },
        signal,
        undefined,
        {} as never
      );
      const exitCode = extractExitCode(raw);
      const output = truncateUtf8(
        extractTextFromToolResult(raw),
        AUTONOMOUS_OUTPUT_TRUNCATE_BYTES
      );
      results.push({
        kind,
        command,
        exitCode,
        output,
        ok: exitCode === 0,
      });
      log(`[Autonomous] ${kind} exit=${exitCode} cmd=${command}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(`[Autonomous] ${kind} failed to execute:`, error);
      results.push({
        kind,
        command,
        exitCode: 1,
        output: truncateUtf8(message, AUTONOMOUS_OUTPUT_TRUNCATE_BYTES),
        ok: false,
      });
    }
  }
  return { commands, results };
}

export { AUTONOMOUS_MAX_ITERATIONS, AUTONOMOUS_OUTPUT_TRUNCATE_BYTES };
