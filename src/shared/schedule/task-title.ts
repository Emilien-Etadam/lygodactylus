export type ScheduleTitleLabels = {
  prefix: string;
  emptyFallback: string;
};

/** Neutral English defaults used when callers omit labels (tests / shared tooling). */
export const DEFAULT_SCHEDULE_TITLE_LABELS: ScheduleTitleLabels = {
  prefix: '[Scheduled Task]',
  emptyFallback: 'Untitled task',
};

const DEFAULT_SUMMARY_MAX_LENGTH = 48;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPrefixPattern(knownPrefixes: string[]): RegExp {
  const unique = [...new Set(knownPrefixes.map((prefix) => prefix.trim()).filter(Boolean))];
  const prefixes = unique.length > 0 ? unique : [DEFAULT_SCHEDULE_TITLE_LABELS.prefix];
  return new RegExp(`^\\s*(?:${prefixes.map(escapeRegExp).join('|')})\\s*`);
}

function normalizeTitlePart(value: string): string {
  return value
    .trim()
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function stripSchedulePrefix(value: string, knownPrefixes: string[]): string {
  return value.replace(buildPrefixPattern(knownPrefixes), '').trim();
}

export function summarizeSchedulePrompt(
  prompt: string,
  maxLength: number = DEFAULT_SUMMARY_MAX_LENGTH,
  labels: ScheduleTitleLabels = DEFAULT_SCHEDULE_TITLE_LABELS
): string {
  const normalizedPrompt = normalizeTitlePart(prompt);
  if (!normalizedPrompt) {
    return labels.emptyFallback;
  }
  if (!Number.isFinite(maxLength) || maxLength <= 0) {
    return normalizedPrompt;
  }
  if (normalizedPrompt.length <= maxLength) {
    return normalizedPrompt;
  }
  return `${normalizedPrompt.slice(0, Math.max(1, maxLength - 3))}...`;
}

export function buildScheduledTaskTitle(
  titleOrSummary: string,
  labels: ScheduleTitleLabels = DEFAULT_SCHEDULE_TITLE_LABELS,
  knownPrefixes: string[] = [labels.prefix]
): string {
  const prefixes = knownPrefixes.includes(labels.prefix)
    ? knownPrefixes
    : [...knownPrefixes, labels.prefix];
  const normalized = normalizeTitlePart(stripSchedulePrefix(titleOrSummary, prefixes));
  const summary = normalized || labels.emptyFallback;
  return `${labels.prefix} ${summary}`;
}

export function buildScheduledTaskFallbackTitle(
  prompt: string,
  labels: ScheduleTitleLabels = DEFAULT_SCHEDULE_TITLE_LABELS,
  knownPrefixes: string[] = [labels.prefix]
): string {
  return buildScheduledTaskTitle(summarizeSchedulePrompt(prompt, undefined, labels), labels, knownPrefixes);
}
