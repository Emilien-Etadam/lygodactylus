import {
  buildScheduledTaskFallbackTitle as buildFallbackTitle,
  buildScheduledTaskTitle as buildTitle,
  summarizeSchedulePrompt as summarizePrompt,
  type ScheduleTitleLabels,
} from '../../shared/schedule/task-title';
import { mt } from '../i18n';
import { backendCatalog, SUPPORTED_BACKEND_LANGUAGES } from '../i18n/catalog';

export function getScheduleTitleLabels(): ScheduleTitleLabels {
  return {
    prefix: mt('scheduleTitlePrefix'),
    emptyFallback: mt('scheduleEmptyTitle'),
  };
}

/** All localized schedule prefixes so legacy titles from another language still strip cleanly. */
export function getKnownScheduleTitlePrefixes(): string[] {
  return SUPPORTED_BACKEND_LANGUAGES.map((lang) => backendCatalog[lang].scheduleTitlePrefix);
}

export function buildScheduledTaskTitle(titleOrSummary: string): string {
  return buildTitle(titleOrSummary, getScheduleTitleLabels(), getKnownScheduleTitlePrefixes());
}

export function buildScheduledTaskFallbackTitle(prompt: string): string {
  return buildFallbackTitle(prompt, getScheduleTitleLabels(), getKnownScheduleTitlePrefixes());
}

export function summarizeSchedulePrompt(prompt: string, maxLength?: number): string {
  return summarizePrompt(prompt, maxLength, getScheduleTitleLabels());
}
