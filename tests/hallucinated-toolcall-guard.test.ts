import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_HALLUCINATED_TOOLCALL_CONFIG,
  HallucinatedToolCallGuard,
  buildHallucinatedToolCallSteerMessage,
  findHallucinatedToolCall,
  stripCodeSpans,
} from '../src/main/agent/hallucinated-toolcall-guard';

describe('stripCodeSpans', () => {
  it('removes fenced code blocks', () => {
    const text = 'before\n```xml\n<tool_call>x</tool_call>\n```\nafter';
    expect(stripCodeSpans(text)).not.toContain('<tool_call>');
    expect(stripCodeSpans(text)).toContain('before');
    expect(stripCodeSpans(text)).toContain('after');
  });

  it('removes unterminated fenced code blocks', () => {
    const text = 'before\n```\n<tool_call>x';
    expect(stripCodeSpans(text)).not.toContain('<tool_call>');
  });

  it('removes inline code spans', () => {
    const text = 'the `<tool_call>` tag is used by Qwen';
    expect(stripCodeSpans(text)).not.toContain('<tool_call>');
  });
});

describe('findHallucinatedToolCall', () => {
  it('detects a Qwen-style JSON payload wrapped in tool_call tags', () => {
    const match = findHallucinatedToolCall(
      'Let me check the file.\n<tool_call>\n{"name": "read_file", "arguments": {"path": "a.ts"}}\n</tool_call>'
    );
    expect(match?.pattern).toBe('tool_call_tag');
    expect(match?.toolName).toBe('read_file');
  });

  it('detects an XML function-tag call and extracts the tool name', () => {
    const match = findHallucinatedToolCall(
      '<tool_call>\n<function=grep>\n<parameter=pattern>foo</parameter>\n</function>\n</tool_call>'
    );
    expect(match?.pattern).toBe('function_tag');
    expect(match?.toolName).toBe('grep');
  });

  it('detects a bare closing tool_call tag without a tool name', () => {
    const match = findHallucinatedToolCall('…arguments here</tool_call>');
    expect(match?.pattern).toBe('tool_call_tag');
    expect(match?.toolName).toBeUndefined();
  });

  it('detects function_call and tool_use tag variants', () => {
    expect(findHallucinatedToolCall('<function_call>{"name": "glob"}</function_call>')?.pattern).toBe(
      'function_call_tag'
    );
    expect(findHallucinatedToolCall('<tool_use>{"name": "glob"}</tool_use>')?.pattern).toBe(
      'tool_use_tag'
    );
  });

  it('ignores plain answers', () => {
    expect(findHallucinatedToolCall('The function returns 42.')).toBeNull();
    expect(findHallucinatedToolCall('')).toBeNull();
  });

  it('ignores tags quoted in fenced or inline code (documentation answers)', () => {
    expect(
      findHallucinatedToolCall('Qwen wraps calls like this:\n```\n<tool_call>…</tool_call>\n```')
    ).toBeNull();
    expect(findHallucinatedToolCall('use the `<tool_call>` wrapper')).toBeNull();
  });

  it('does not match ordinary HTML in answers', () => {
    expect(findHallucinatedToolCall('<div class="tool">call me</div>')).toBeNull();
  });
});

describe('HallucinatedToolCallGuard', () => {
  const hallucinatedText = '<tool_call>{"name": "read_file", "arguments": {}}</tool_call>';

  it('never fires when the turn contains structured tool calls', () => {
    const guard = new HallucinatedToolCallGuard();
    const decision = guard.inspectTurn({
      text: hallucinatedText,
      thinking: '',
      structuredToolCallCount: 1,
    });
    expect(decision.action).toBe('none');
  });

  it('steers when the text contains a tool-call-shaped fragment and no structured call', () => {
    const guard = new HallucinatedToolCallGuard();
    const decision = guard.inspectTurn({
      text: hallucinatedText,
      thinking: '',
      structuredToolCallCount: 0,
    });
    expect(decision.action).toBe('steer');
    expect(decision.match?.toolName).toBe('read_file');
    expect(decision.steerCount).toBe(1);
  });

  it('inspects thinking only on reasoning-only turns', () => {
    const guard = new HallucinatedToolCallGuard();
    // Text present → thinking is NOT inspected even if it contains the pattern.
    const withText = guard.inspectTurn({
      text: 'Here is my final answer.',
      thinking: hallucinatedText,
      structuredToolCallCount: 0,
    });
    expect(withText.action).toBe('none');

    // Reasoning-only turn → thinking IS inspected.
    const reasoningOnly = guard.inspectTurn({
      text: '',
      thinking: hallucinatedText,
      structuredToolCallCount: 0,
    });
    expect(reasoningOnly.action).toBe('steer');
  });

  it('stops steering after maxSteersPerRun and reports exhausted', () => {
    const guard = new HallucinatedToolCallGuard({ maxSteersPerRun: 2 });
    const snapshot = { text: hallucinatedText, thinking: '', structuredToolCallCount: 0 };
    expect(guard.inspectTurn(snapshot).action).toBe('steer');
    expect(guard.inspectTurn(snapshot).action).toBe('steer');
    const third = guard.inspectTurn(snapshot);
    expect(third.action).toBe('exhausted');
    expect(guard.snapshot().steersIssued).toBe(2);
  });

  it('defaults to a small steer budget', () => {
    expect(DEFAULT_HALLUCINATED_TOOLCALL_CONFIG.maxSteersPerRun).toBe(2);
  });

  it('stays silent on clean turns', () => {
    const guard = new HallucinatedToolCallGuard();
    const decision = guard.inspectTurn({
      text: 'All done — the tests pass.',
      thinking: 'I already ran the tests.',
      structuredToolCallCount: 0,
    });
    expect(decision.action).toBe('none');
    expect(guard.snapshot().steersIssued).toBe(0);
  });
});

describe('buildHallucinatedToolCallSteerMessage', () => {
  it('names the tool when it was extracted', () => {
    const guard = new HallucinatedToolCallGuard();
    const decision = guard.inspectTurn({
      text: '<tool_call>{"name": "grep", "arguments": {}}</tool_call>',
      thinking: '',
      structuredToolCallCount: 0,
    });
    const message = buildHallucinatedToolCallSteerMessage(decision);
    expect(message).toContain('"grep"');
    expect(message).toContain('re-issue');
  });

  it('stays generic when no tool name was extracted', () => {
    const message = buildHallucinatedToolCallSteerMessage({
      action: 'steer',
      reason: 'test',
      match: { pattern: 'tool_call_tag' },
    });
    expect(message).toContain('[Tool-Call Guard]');
    expect(message).not.toContain('It looks like you were trying');
  });
});

describe('stream-pipeline wiring pins', () => {
  const streamHandlerContent = readFileSync(
    path.resolve(process.cwd(), 'src/main/agent/agent-runner-stream-handler.ts'),
    'utf8'
  );
  const messageEventsContent = readFileSync(
    path.resolve(process.cwd(), 'src/main/agent/agent-runner-stream-message-events.ts'),
    'utf8'
  );

  it('instantiates a fresh guard per run next to the loop guard', () => {
    expect(streamHandlerContent).toContain(
      'const hallucinatedToolCallGuard = new HallucinatedToolCallGuard();'
    );
  });

  it('inspects the turn only when no structured tool calls were made', () => {
    const guardCallIdx = messageEventsContent.indexOf('hallucinatedToolCallGuard.inspectTurn');
    expect(guardCallIdx).toBeGreaterThan(-1);
    // The inspection lives in the else-branch of the structured-tool-call check.
    const branchIdx = messageEventsContent.lastIndexOf(
      'toolUseDescriptors.length > 0',
      guardCallIdx
    );
    expect(branchIdx).toBeGreaterThan(-1);
  });

  it('runs the inspection after the user-message echo early-return (steer echoes are ignored)', () => {
    const emitCheckIdx = messageEventsContent.indexOf('if (!resolvedPayload.shouldEmitMessage)');
    const guardCallIdx = messageEventsContent.indexOf('hallucinatedToolCallGuard.inspectTurn');
    expect(emitCheckIdx).toBeGreaterThan(-1);
    expect(guardCallIdx).toBeGreaterThan(emitCheckIdx);
  });
});
