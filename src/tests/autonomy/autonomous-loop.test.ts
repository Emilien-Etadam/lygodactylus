import { describe, expect, it, vi } from 'vitest';
import {
  AUTONOMOUS_MAX_ITERATIONS,
  AUTONOMOUS_OUTPUT_TRUNCATE_BYTES,
  buildFixPrompt,
  decideAutonomousLoop,
  resetAutonomousIteration,
  runConfiguredQualityCommands,
} from '../../main/autonomy/autonomous-loop';
import { truncateUtf8 } from '../../main/autonomy/unified-diff';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

describe('decideAutonomousLoop', () => {
  it('stops when no files were modified', () => {
    const decision = decideAutonomousLoop({
      sessionId: 's1',
      filesModified: false,
      commandsConfigured: true,
      results: [{ kind: 'lint', command: 'lint', exitCode: 1, output: 'err', ok: false }],
      currentIteration: 0,
    });
    expect(decision.action).toBe('stop');
  });

  it('stops when commands succeed', () => {
    const decision = decideAutonomousLoop({
      sessionId: 's1',
      filesModified: true,
      commandsConfigured: true,
      results: [{ kind: 'lint', command: 'lint', exitCode: 0, output: 'ok', ok: true }],
      currentIteration: 0,
    });
    expect(decision.action).toBe('stop');
  });

  it('retries on failure until ceiling then summarizes', () => {
    resetAutonomousIteration('s1');
    const fail = [
      { kind: 'lint' as const, command: 'lint', exitCode: 1, output: 'boom', ok: false },
    ];

    const first = decideAutonomousLoop({
      sessionId: 's1',
      filesModified: true,
      commandsConfigured: true,
      results: fail,
      currentIteration: 0,
    });
    expect(first.action).toBe('retry');
    expect(first.iteration).toBe(1);
    expect(first.fixPrompt).toContain('Automatic quality check failed');

    const mid = decideAutonomousLoop({
      sessionId: 's1',
      filesModified: true,
      commandsConfigured: true,
      results: fail,
      currentIteration: AUTONOMOUS_MAX_ITERATIONS - 1,
    });
    expect(mid.action).toBe('retry');
    expect(mid.iteration).toBe(AUTONOMOUS_MAX_ITERATIONS);

    const last = decideAutonomousLoop({
      sessionId: 's1',
      filesModified: true,
      commandsConfigured: true,
      results: fail,
      currentIteration: AUTONOMOUS_MAX_ITERATIONS,
    });
    expect(last.action).toBe('summary');
    expect(last.summaryText).toContain('Autonomous mode stopped');
  });
});

describe('truncateUtf8 / autonomous output ceiling', () => {
  it('truncates to 8 KiB', () => {
    const big = 'x'.repeat(AUTONOMOUS_OUTPUT_TRUNCATE_BYTES + 1000);
    const truncated = truncateUtf8(big, AUTONOMOUS_OUTPUT_TRUNCATE_BYTES);
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(
      AUTONOMOUS_OUTPUT_TRUNCATE_BYTES
    );
    expect(truncated.endsWith('…[truncated]')).toBe(true);
  });

  it('buildFixPrompt includes truncated failure output', () => {
    const prompt = buildFixPrompt(
      [{ kind: 'test', command: 'npm test', exitCode: 1, output: 'FAIL', ok: false }],
      2
    );
    expect(prompt).toContain('iteration 2/');
    expect(prompt).toContain('FAIL');
  });
});

describe('runConfiguredQualityCommands', () => {
  it('returns empty results when bash tool missing', async () => {
    const { results } = await runConfiguredQualityCommands(undefined, '/tmp');
    expect(results).toEqual([]);
  });

  it('returns empty results when no commands configured (default)', async () => {
    const bashTool = {
      name: 'bash',
      execute: vi.fn(),
    } as unknown as ToolDefinition;
    const { results } = await runConfiguredQualityCommands(bashTool, '/tmp/no-tooling-configured');
    expect(results).toEqual([]);
    expect(bashTool.execute).not.toHaveBeenCalled();
  });
});
