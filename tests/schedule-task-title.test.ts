import { afterEach, describe, expect, it } from 'vitest';
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
  summarizeSchedulePrompt,
} from '../src/shared/schedule/task-title';
import {
  buildScheduledTaskTitle as buildLocalizedScheduledTaskTitle,
  getKnownScheduleTitlePrefixes,
  getScheduleTitleLabels,
} from '../src/main/schedule/schedule-title-i18n';
import { setBackendLanguage } from '../src/main/i18n';
import { DEFAULT_BACKEND_LANGUAGE } from '../src/main/i18n/catalog';

describe('scheduled task title (shared, language-agnostic)', () => {
  it('always prefixes with the provided label', () => {
    expect(
      buildScheduledTaskTitle('Summarize today tasks', {
        prefix: '[Scheduled Task]',
        emptyFallback: 'Untitled task',
      })
    ).toBe('[Scheduled Task] Summarize today tasks');
  });

  it('normalizes whitespace and line breaks', () => {
    expect(
      buildScheduledTaskTitle('  First line\n\nSecond line   Third line  ', {
        prefix: '[Scheduled Task]',
        emptyFallback: 'Untitled task',
      })
    ).toBe('[Scheduled Task] First line Second line Third line');
  });

  it('strips duplicated schedule prefix', () => {
    expect(
      buildScheduledTaskTitle('[Scheduled Task] Daily summary', {
        prefix: '[Scheduled Task]',
        emptyFallback: 'Untitled task',
      })
    ).toBe('[Scheduled Task] Daily summary');
  });

  it('strips known prefixes from other languages when rebuilding titles', () => {
    expect(
      buildScheduledTaskTitle('[定时任务] Daily summary', {
        prefix: '[Scheduled Task]',
        emptyFallback: 'Untitled task',
      }, ['[Scheduled Task]', '[定时任务]', '[Tâche planifiée]'])
    ).toBe('[Scheduled Task] Daily summary');
  });

  it('truncates very long prompt summary', () => {
    const longPrompt = 'a'.repeat(70);
    expect(summarizeSchedulePrompt(longPrompt)).toBe(`${'a'.repeat(45)}...`);
  });

  it('falls back for empty prompt', () => {
    expect(
      buildScheduledTaskTitle('   ', {
        prefix: '[Scheduled Task]',
        emptyFallback: 'Untitled task',
      })
    ).toBe('[Scheduled Task] Untitled task');
  });

  it('builds fallback title from prompt summary', () => {
    expect(
      buildScheduledTaskFallbackTitle('Search Agent papers this week', {
        prefix: '[Scheduled Task]',
        emptyFallback: 'Untitled task',
      })
    ).toBe('[Scheduled Task] Search Agent papers this week');
  });
});

describe('scheduled task title (backend language)', () => {
  afterEach(() => setBackendLanguage(DEFAULT_BACKEND_LANGUAGE));

  it('uses the active backend language for prefix and empty fallback', () => {
    setBackendLanguage('fr');
    expect(getScheduleTitleLabels()).toEqual({
      prefix: '[Tâche planifiée]',
      emptyFallback: 'Tâche sans nom',
    });
    expect(buildLocalizedScheduledTaskTitle('Synthèse quotidienne')).toBe(
      '[Tâche planifiée] Synthèse quotidienne'
    );

    setBackendLanguage('zh');
    expect(buildLocalizedScheduledTaskTitle('每日汇总')).toBe('[定时任务] 每日汇总');

    setBackendLanguage('en');
    expect(buildLocalizedScheduledTaskTitle('Daily summary')).toBe(
      '[Scheduled Task] Daily summary'
    );
  });

  it('exposes every catalog prefix for cross-language stripping', () => {
    const prefixes = getKnownScheduleTitlePrefixes();
    expect(prefixes).toContain('[Scheduled Task]');
    expect(prefixes).toContain('[定时任务]');
    expect(prefixes).toContain('[Tâche planifiée]');
  });
});
