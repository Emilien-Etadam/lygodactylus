import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const agentRunnerRunPath = path.resolve(process.cwd(), 'src/main/claude/agent-runner-run.ts');
const agentRunnerStreamHandlerPath = path.resolve(
  process.cwd(),
  'src/main/claude/agent-runner-stream-handler.ts'
);
const agentRunnerRunContent = readFileSync(agentRunnerRunPath, 'utf8');
const agentRunnerStreamHandlerContent = readFileSync(agentRunnerStreamHandlerPath, 'utf8');

/**
 * These tests pin the split-module disposition for loop-guard aborts. The bug
 * they guard against: when handleLoopGuardDecision called controller.abort(),
 * later orchestration paths overwrote the loop-guard's error trace step with
 * the generic user-cancel "Cancelled" state.
 */
describe('agent-runner loop-guard abort preserves error trace status', () => {
  it('declares an abortedByLoopGuard flag in the prompt() scope', () => {
    expect(agentRunnerStreamHandlerContent).toContain('let abortedByLoopGuard = false;');
  });

  it('sets the flag immediately before controller.abort() in handleLoopGuardDecision', () => {
    const setIdx = agentRunnerStreamHandlerContent.indexOf('abortedByLoopGuard = true;');
    expect(setIdx).toBeGreaterThan(-1);

    const abortIdx = agentRunnerStreamHandlerContent.indexOf('controller.abort();', setIdx);
    expect(abortIdx).toBeGreaterThan(setIdx);

    const between = agentRunnerStreamHandlerContent.slice(setIdx, abortIdx);
    const nonTrivialLines = between
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//'));
    expect(nonTrivialLines.length).toBeLessThanOrEqual(2);
  });

  it('the orchestration short-circuit checks preserve-existing-trace before the user-cancel branch', () => {
    const start = agentRunnerRunContent.indexOf('shouldPreserveExistingTrace(abortDisposition)');
    expect(start).toBeGreaterThan(-1);
    const end = agentRunnerRunContent.indexOf("title: 'Cancelled'", start);
    expect(end).toBeGreaterThan(start);
    const block = agentRunnerRunContent.slice(start, end + 200);

    const loopGuardBranchIdx = block.indexOf("abortDisposition === 'loop_guard'");
    const userCancelIdx = block.indexOf("title: 'Cancelled'");
    expect(loopGuardBranchIdx).toBeGreaterThan(-1);
    expect(userCancelIdx).toBeGreaterThan(loopGuardBranchIdx);
  });

  it('the post-prompt short-circuit also returns early on a swallowed loop-guard abort', () => {
    expect(agentRunnerRunContent).toContain('shouldPreserveExistingTrace(abortDisposition)');
    expect(agentRunnerRunContent).toContain(
      "abortDisposition === 'loop_guard' ? 'loop guard' : 'stream error'"
    );
  });

  it('the loop-guard decision handler still publishes the error trace step before aborting', () => {
    expect(agentRunnerStreamHandlerContent).toContain("title: 'Stopped: tool-call loop detected'");
    const titleIdx = agentRunnerStreamHandlerContent.indexOf(
      "title: 'Stopped: tool-call loop detected'"
    );
    const localStart = agentRunnerStreamHandlerContent.lastIndexOf('sendTraceUpdate', titleIdx);
    const localBlock = agentRunnerStreamHandlerContent.slice(localStart, titleIdx);
    expect(localBlock).toContain("status: 'error'");
  });

  it('always emits the buildAbortUserMessage explanation, even if a prior error set hasEmittedError', () => {
    const sendIdx = agentRunnerStreamHandlerContent.indexOf(
      'text: buildAbortUserMessage(decision)'
    );
    expect(sendIdx).toBeGreaterThan(-1);

    const preamble = agentRunnerStreamHandlerContent.slice(Math.max(0, sendIdx - 400), sendIdx);
    expect(preamble).not.toMatch(/if\s*\(\s*!hasEmittedError\s*\)\s*\{/);

    const trailing = agentRunnerStreamHandlerContent.slice(sendIdx, sendIdx + 400);
    expect(trailing).toContain('hasEmittedError = true');
  });
});
