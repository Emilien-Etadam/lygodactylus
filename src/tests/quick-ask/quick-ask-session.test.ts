import { describe, expect, it } from 'vitest';
import {
  QUICK_ASK_SESSION_TITLE,
  QUICK_ASK_SYSTEM_PROMPT,
  findQuickAskSession,
  isQuickAskSessionTitle,
  resolveQuickAskSessionAction,
} from '../../shared/quick-ask';
import { PLAN_MODE_SYSTEM_PROMPT } from '../../shared/session-mode';

describe('quick-ask session helpers', () => {
  it('identifies the dedicated session by title', () => {
    expect(isQuickAskSessionTitle(QUICK_ASK_SESSION_TITLE)).toBe(true);
    expect(isQuickAskSessionTitle('Other')).toBe(false);
    expect(isQuickAskSessionTitle(null)).toBe(false);
  });

  it('finds an existing quick-ask session among many', () => {
    const sessions = [
      { id: 'a', title: 'Chat 1' },
      { id: 'qa', title: QUICK_ASK_SESSION_TITLE },
      { id: 'b', title: 'Chat 2' },
    ];
    expect(findQuickAskSession(sessions)?.id).toBe('qa');
  });

  it('resolves create vs reuse', () => {
    expect(resolveQuickAskSessionAction([])).toEqual({ action: 'create' });
    expect(resolveQuickAskSessionAction([{ id: 'x', title: 'Nope' }])).toEqual({
      action: 'create',
    });
    expect(
      resolveQuickAskSessionAction([
        { id: 'x', title: 'Nope' },
        { id: 'qa-1', title: QUICK_ASK_SESSION_TITLE },
      ])
    ).toEqual({ action: 'reuse', sessionId: 'qa-1' });
  });

  it('exposes a Q&A system prompt distinct from plan-mode planning instructions', () => {
    expect(QUICK_ASK_SYSTEM_PROMPT).toContain('<quick_ask>');
    expect(QUICK_ASK_SYSTEM_PROMPT).toContain('concisely');
    expect(QUICK_ASK_SYSTEM_PROMPT).not.toBe(PLAN_MODE_SYSTEM_PROMPT);
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('numbered action plan');
  });
});
