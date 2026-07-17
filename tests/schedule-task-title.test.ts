import { describe, expect, it } from 'vitest';
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
  summarizeSchedulePrompt,
} from '../src/shared/schedule/task-title';

describe('scheduled task title', () => {
  it('always prefixes with [Tâche planifiée]', () => {
    expect(buildScheduledTaskTitle('Résumer les tâches du jour')).toBe(
      '[Tâche planifiée] Résumer les tâches du jour'
    );
  });

  it('normalizes whitespace and line breaks', () => {
    expect(buildScheduledTaskTitle('  Première ligne\n\nDeuxième ligne   Troisième ligne  ')).toBe(
      '[Tâche planifiée] Première ligne Deuxième ligne Troisième ligne'
    );
  });

  it('strips duplicated schedule prefix', () => {
    expect(buildScheduledTaskTitle('[Tâche planifiée] Synthèse quotidienne')).toBe(
      '[Tâche planifiée] Synthèse quotidienne'
    );
  });

  it('strips legacy Chinese schedule prefix when rebuilding titles', () => {
    expect(buildScheduledTaskTitle('[定时任务] Synthèse quotidienne')).toBe(
      '[Tâche planifiée] Synthèse quotidienne'
    );
  });

  it('truncates very long prompt summary', () => {
    const longPrompt = 'a'.repeat(70);
    expect(summarizeSchedulePrompt(longPrompt)).toBe(`${'a'.repeat(45)}...`);
  });

  it('falls back for empty prompt', () => {
    expect(buildScheduledTaskTitle('   ')).toBe('[Tâche planifiée] Tâche sans nom');
  });

  it('builds fallback title from prompt summary', () => {
    expect(
      buildScheduledTaskFallbackTitle('Recherche des articles Agent de la semaine')
    ).toBe('[Tâche planifiée] Recherche des articles Agent de la semaine');
  });
});
