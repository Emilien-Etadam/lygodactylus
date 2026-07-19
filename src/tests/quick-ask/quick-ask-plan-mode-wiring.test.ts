import { describe, expect, it } from 'vitest';
import { QUICK_ASK_SYSTEM_PROMPT } from '../../shared/quick-ask';
import { PLAN_MODE_SYSTEM_PROMPT } from '../../shared/session-mode';

/**
 * Documents the prompt choice for Quick Ask sessions:
 * - Tool gating: session.mode = 'plan' → session-mode.ts (single point).
 * - System prompt: QUICK_ASK_SYSTEM_PROMPT *replaces* PLAN_MODE_SYSTEM_PROMPT
 *   (not stacked), because plan mode asks for a numbered action plan which is
 *   the wrong UX for the floating Q&A window.
 */
describe('quick-ask plan-mode prompt wiring', () => {
  it('keeps a dedicated quick-ask prompt that replaces plan-mode planning copy', () => {
    const coworkSections = [
      'You are an Lygodactylus assistant.',
      PLAN_MODE_SYSTEM_PROMPT,
      '<workspace_info>…</workspace_info>',
    ];
    const isQuickAsk = true;
    const resolved = isQuickAsk
      ? [
          ...coworkSections.filter((section) => section !== PLAN_MODE_SYSTEM_PROMPT),
          QUICK_ASK_SYSTEM_PROMPT,
        ]
      : coworkSections;

    expect(resolved).toContain(QUICK_ASK_SYSTEM_PROMPT);
    expect(resolved).not.toContain(PLAN_MODE_SYSTEM_PROMPT);
  });
});
