import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_MODE,
  filterToolsForSessionMode,
  getPlanModeExcludedBuiltinTools,
  isToolAllowedInSessionMode,
  normalizeSessionMode,
  PLAN_MODE_SYSTEM_PROMPT,
} from '../../shared/session-mode';
import { buildPiSessionRuntimeSignature } from '../../main/agent/pi-session-runtime';

function tool(name: string): { name: string } {
  return { name };
}

/** Representative assembled toolset (mirrors agent-runner-pi-setup assembly). */
const FULL_TOOLSET = [
  tool('bash'),
  tool('glob'),
  tool('find'),
  tool('grep'),
  tool('web_fetch'),
  tool('WebFetch'),
  tool('http_request'),
  tool('HttpRequest'),
  tool('todo_write'),
  tool('TodoWrite'),
  tool('ask_user_question'),
  tool('AskUserQuestion'),
  tool('web_search'),
  tool('websearch'),
  tool('WebSearch'),
  tool('schedule_create'),
  tool('schedule_list'),
  tool('mcp__filesystem__read_file'),
  tool('mcp__Chrome__navigate'),
  tool('extension_custom_write'),
];

describe('session plan/act mode', () => {
  it('defaults to act', () => {
    expect(DEFAULT_SESSION_MODE).toBe('act');
    expect(normalizeSessionMode(undefined)).toBe('act');
    expect(normalizeSessionMode('nope')).toBe('act');
    expect(normalizeSessionMode('plan')).toBe('plan');
  });

  it('keeps the full toolset unchanged in act mode (same reference)', () => {
    const filtered = filterToolsForSessionMode(FULL_TOOLSET, 'act');
    expect(filtered).toBe(FULL_TOOLSET);
    expect(filtered.map((t) => t.name)).toEqual(FULL_TOOLSET.map((t) => t.name));
    expect(getPlanModeExcludedBuiltinTools('act')).toBeUndefined();
  });

  it('filters plan-mode toolset: keeps read-like + web_search, drops write/bash/http_request', () => {
    const filtered = filterToolsForSessionMode(FULL_TOOLSET, 'plan');
    const names = filtered.map((t) => t.name);

    expect(names).toContain('glob');
    expect(names).toContain('grep');
    expect(names).toContain('find');
    expect(names).toContain('web_search');
    expect(names).toContain('web_fetch');
    expect(names).toContain('ask_user_question');
    expect(names).toContain('todo_write');

    expect(names).not.toContain('bash');
    expect(names).not.toContain('http_request');
    expect(names).not.toContain('HttpRequest');
    expect(names).not.toContain('schedule_create');
    expect(names).not.toContain('extension_custom_write');

    expect(getPlanModeExcludedBuiltinTools('plan')).toEqual(['bash', 'edit', 'write']);
  });

  it('blocks all MCP tools in plan mode (conservative, no read-only metadata)', () => {
    expect(isToolAllowedInSessionMode('mcp__filesystem__read_file', 'plan')).toBe(false);
    expect(isToolAllowedInSessionMode('mcp__Chrome__navigate', 'plan')).toBe(false);
    expect(isToolAllowedInSessionMode('mcp_legacy_tool', 'plan')).toBe(false);

    const filtered = filterToolsForSessionMode(FULL_TOOLSET, 'plan');
    expect(filtered.every((t) => !t.name.startsWith('mcp'))).toBe(true);
  });

  it('exposes a constant plan-mode system prompt section', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('Planning mode');
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('numbered action plan');
  });

  it('keeps act-mode runtime signature identical when sessionMode is omitted or act', () => {
    const baseInput = {
      configProvider: 'openai',
      customProtocol: 'openai-completions',
      modelProvider: 'openai',
      modelApi: 'openai-completions',
      modelBaseUrl: 'http://localhost:11434/v1',
      effectiveCwd: '/tmp/ws',
      apiKey: 'secret',
    };
    const withoutMode = buildPiSessionRuntimeSignature(baseInput);
    const withAct = buildPiSessionRuntimeSignature({ ...baseInput, sessionMode: 'act' });
    const withPlan = buildPiSessionRuntimeSignature({ ...baseInput, sessionMode: 'plan' });

    expect(withAct).toBe(withoutMode);
    expect(withPlan).not.toBe(withoutMode);
    expect(withPlan).toContain('"sessionMode":"plan"');
  });
});
