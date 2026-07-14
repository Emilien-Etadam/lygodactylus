/**
 * @module main/schedule/schedule-tools
 *
 * Agent-facing tools that expose scheduled task management (Settings → Schedule)
 * to the LLM. Mirrors the renderer IPC surface (schedule.list/create/update/
 * delete/toggle/runNow) with flat, LLM-friendly parameters.
 */
import { Type, type TSchema } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import {
  computeNextRunAtFromScheduleConfig,
  type ScheduledTask,
  type ScheduledTaskCreateInput,
  type ScheduledTaskScheduleConfig,
  type ScheduledTaskUpdateInput,
  type ScheduledTaskWeekday,
  type ScheduleRepeatUnit,
} from './scheduled-task-manager';

export type ScheduleToolKind = 'once' | 'daily' | 'weekly' | 'interval';

export interface ScheduleToolsManager {
  list(): ScheduledTask[];
  get(id: string): ScheduledTask | null;
  create(input: ScheduledTaskCreateInput): ScheduledTask;
  update(id: string, updates: ScheduledTaskUpdateInput): ScheduledTask | null;
  delete(id: string): boolean;
  toggle(id: string, enabled: boolean): ScheduledTask | null;
  runNow(id: string): Promise<ScheduledTask | null>;
}

export interface ScheduleToolsContext {
  getManager: () => ScheduleToolsManager | null;
  defaultCwd?: string;
  getCwdUnsupportedReason?: (cwd: string) => string | null;
  now?: () => number;
}

export interface ScheduleToolDefinition extends ToolDefinition<TSchema, unknown> {}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const scheduleKindSchema = Type.Union(
  [
    Type.Literal('once'),
    Type.Literal('daily'),
    Type.Literal('weekly'),
    Type.Literal('interval'),
  ],
  {
    description:
      'once = run a single time at run_at; daily = every day at times; weekly = on weekdays at times; interval = repeat every repeat_every repeat_unit starting at run_at.',
  }
);

const createParameters = Type.Object({
  prompt: Type.String({
    minLength: 1,
    description: 'Prompt executed when the task fires (a new agent session is started with it).',
  }),
  title: Type.Optional(
    Type.String({ description: 'Optional short title. Omit to derive one from the prompt.' })
  ),
  cwd: Type.Optional(
    Type.String({
      description:
        'Absolute working directory for the scheduled run. Omit to use the current workspace.',
    })
  ),
  schedule_kind: Type.Optional(scheduleKindSchema),
  run_at: Type.Optional(
    Type.String({
      description:
        'Local date-time such as 2026-07-14T08:00. Required for kind once and interval; must be in the future. Ignored for daily/weekly (next slot is computed from times).',
    })
  ),
  times: Type.Optional(
    Type.Array(Type.String(), {
      description: 'HH:mm times of day (24h), for kind daily and weekly. Example: ["08:00"].',
    })
  ),
  weekdays: Type.Optional(
    Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), {
      description: 'Weekdays for kind weekly. 0=Sunday, 1=Monday, ... 6=Saturday.',
    })
  ),
  repeat_every: Type.Optional(
    Type.Integer({ minimum: 1, description: 'Interval count for kind interval.' })
  ),
  repeat_unit: Type.Optional(
    Type.Union([Type.Literal('minute'), Type.Literal('hour'), Type.Literal('day')], {
      description: 'Interval unit for kind interval.',
    })
  ),
  enabled: Type.Optional(Type.Boolean({ description: 'Defaults to true.' })),
});

const updateParameters = Type.Object({
  id: Type.String({ minLength: 1, description: 'Task id returned by schedule_list.' }),
  prompt: Type.Optional(Type.String({ minLength: 1 })),
  title: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()),
  schedule_kind: Type.Optional(scheduleKindSchema),
  run_at: Type.Optional(
    Type.String({
      description: 'New local date-time (e.g. 2026-07-14T08:00) for kind once/interval.',
    })
  ),
  times: Type.Optional(Type.Array(Type.String())),
  weekdays: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 6 }))),
  repeat_every: Type.Optional(Type.Integer({ minimum: 1 })),
  repeat_unit: Type.Optional(
    Type.Union([Type.Literal('minute'), Type.Literal('hour'), Type.Literal('day')])
  ),
  enabled: Type.Optional(Type.Boolean()),
});

const idParameters = Type.Object({
  id: Type.String({ minLength: 1, description: 'Task id returned by schedule_list.' }),
});

const toggleParameters = Type.Object({
  id: Type.String({ minLength: 1, description: 'Task id returned by schedule_list.' }),
  enabled: Type.Boolean({ description: 'true to enable, false to disable.' }),
});

function asRecord(params: unknown): Record<string, unknown> {
  return typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {};
}

function textResult(text: string): { content: Array<{ type: 'text'; text: string }>; details: unknown } {
  return {
    content: [{ type: 'text' as const, text }],
    details: undefined as unknown,
  };
}

function parseRunAt(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('run_at is required for this schedule kind (e.g. 2026-07-14T08:00)');
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error(`run_at is not a valid date-time: ${value}`);
  }
  return timestamp;
}

function parseTimes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const times = value.filter(
    (time): time is string => typeof time === 'string' && TIME_PATTERN.test(time)
  );
  return Array.from(new Set(times)).sort();
}

function parseWeekdays(value: unknown): ScheduledTaskWeekday[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const weekdays = value.filter(
    (day): day is ScheduledTaskWeekday => Number.isInteger(day) && day >= 0 && day <= 6
  );
  return Array.from(new Set(weekdays)).sort((left, right) => left - right);
}

function parseScheduleKind(value: unknown): ScheduleToolKind | null {
  if (value === 'once' || value === 'daily' || value === 'weekly' || value === 'interval') {
    return value;
  }
  return null;
}

interface ParsedScheduleFields {
  scheduleConfig: ScheduledTaskScheduleConfig | null;
  repeatEvery: number | null;
  repeatUnit: ScheduleRepeatUnit | null;
  runAt: number | null;
}

function parseScheduleFields(
  kind: ScheduleToolKind,
  record: Record<string, unknown>,
  now: number
): ParsedScheduleFields {
  if (kind === 'daily' || kind === 'weekly') {
    const times = parseTimes(record.times);
    if (times.length === 0) {
      throw new Error(`times is required for kind ${kind} (HH:mm values, e.g. ["08:00"])`);
    }
    let scheduleConfig: ScheduledTaskScheduleConfig;
    if (kind === 'weekly') {
      const weekdays = parseWeekdays(record.weekdays);
      if (weekdays.length === 0) {
        throw new Error('weekdays is required for kind weekly (0=Sunday ... 6=Saturday)');
      }
      scheduleConfig = { kind: 'weekly', weekdays, times };
    } else {
      scheduleConfig = { kind: 'daily', times };
    }
    const runAt = computeNextRunAtFromScheduleConfig(scheduleConfig, now);
    if (runAt === null) {
      throw new Error('Could not compute the next run time from the provided schedule');
    }
    return { scheduleConfig, repeatEvery: null, repeatUnit: null, runAt };
  }

  const runAt = parseRunAt(record.run_at);
  if (runAt <= now) {
    throw new Error('run_at must be in the future');
  }
  if (kind === 'interval') {
    const repeatEvery = typeof record.repeat_every === 'number' ? record.repeat_every : null;
    const repeatUnit =
      record.repeat_unit === 'minute' || record.repeat_unit === 'hour' || record.repeat_unit === 'day'
        ? record.repeat_unit
        : null;
    if (!repeatEvery || repeatEvery < 1 || !repeatUnit) {
      throw new Error('repeat_every and repeat_unit are required for kind interval');
    }
    return {
      scheduleConfig: null,
      repeatEvery: Math.floor(repeatEvery),
      repeatUnit,
      runAt,
    };
  }
  return { scheduleConfig: null, repeatEvery: null, repeatUnit: null, runAt };
}

function describeRule(task: ScheduledTask): string {
  if (task.scheduleConfig?.kind === 'daily') {
    return `daily at ${task.scheduleConfig.times.join(', ')}`;
  }
  if (task.scheduleConfig?.kind === 'weekly') {
    return `weekly on weekdays [${task.scheduleConfig.weekdays.join(', ')}] at ${task.scheduleConfig.times.join(', ')}`;
  }
  if (task.repeatEvery && task.repeatUnit) {
    return `every ${task.repeatEvery} ${task.repeatUnit}(s)`;
  }
  return 'once';
}

function formatTimestamp(timestamp: number | null): string {
  if (timestamp === null) {
    return 'none';
  }
  return new Date(timestamp).toISOString();
}

function formatTask(task: ScheduledTask): string {
  const lines = [
    `- id: ${task.id}`,
    `  title: ${task.title}`,
    `  prompt: ${task.prompt}`,
    `  cwd: ${task.cwd}`,
    `  rule: ${describeRule(task)}`,
    `  enabled: ${task.enabled}`,
    `  next_run: ${formatTimestamp(task.nextRunAt)}`,
    `  last_run: ${formatTimestamp(task.lastRunAt)}`,
  ];
  if (task.lastError) {
    lines.push(`  last_error: ${task.lastError}`);
  }
  return lines.join('\n');
}

export function createScheduleTools(ctx: ScheduleToolsContext): ScheduleToolDefinition[] {
  const now = ctx.now ?? (() => Date.now());

  function requireManager(): ScheduleToolsManager {
    const manager = ctx.getManager();
    if (!manager) {
      throw new Error('Scheduled task manager not initialized');
    }
    return manager;
  }

  function resolveCwd(rawCwd: unknown, fallback?: string): string {
    const cwd = typeof rawCwd === 'string' && rawCwd.trim() ? rawCwd.trim() : fallback;
    if (!cwd) {
      throw new Error('cwd is required (no default workspace available)');
    }
    const unsupportedReason = ctx.getCwdUnsupportedReason?.(cwd);
    if (unsupportedReason) {
      throw new Error(unsupportedReason);
    }
    return cwd;
  }

  const listTool: ScheduleToolDefinition = {
    name: 'schedule_list',
    label: 'schedule_list',
    description:
      'List the scheduled tasks configured in the app (Settings → Schedule): recurring or one-shot prompts that run automatically at the configured time.',
    parameters: Type.Object({}),
    async execute() {
      const tasks = requireManager().list();
      const text =
        tasks.length > 0
          ? [`${tasks.length} scheduled task(s):`, ...tasks.map(formatTask)].join('\n\n')
          : 'No scheduled tasks configured.';
      return textResult(text);
    },
  };

  const createTool: ScheduleToolDefinition = {
    name: 'schedule_create',
    label: 'schedule_create',
    description:
      'Create a scheduled task in the app: the prompt is executed automatically in a new agent session at the scheduled time. Supports one-shot (once), daily, weekly, and fixed-interval schedules.',
    parameters: createParameters,
    async execute(_toolCallId, params) {
      const record = asRecord(params);
      const manager = requireManager();
      const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : '';
      if (!prompt) {
        throw new Error('prompt is required');
      }
      const kind = parseScheduleKind(record.schedule_kind) ?? 'once';
      const fields = parseScheduleFields(kind, record, now());
      const cwd = resolveCwd(record.cwd, ctx.defaultCwd);
      const created = manager.create({
        prompt,
        title: typeof record.title === 'string' && record.title.trim() ? record.title : undefined,
        cwd,
        runAt: fields.runAt as number,
        nextRunAt: fields.runAt,
        scheduleConfig: fields.scheduleConfig,
        repeatEvery: fields.repeatEvery,
        repeatUnit: fields.repeatUnit,
        enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
      });
      return textResult(`Scheduled task created:\n${formatTask(created)}`);
    },
  };

  const updateTool: ScheduleToolDefinition = {
    name: 'schedule_update',
    label: 'schedule_update',
    description:
      'Update an existing scheduled task (prompt, title, working directory, or schedule). To change the schedule, pass schedule_kind together with its fields (run_at, times, weekdays, repeat_every/repeat_unit).',
    parameters: updateParameters,
    async execute(_toolCallId, params) {
      const record = asRecord(params);
      const manager = requireManager();
      const id = typeof record.id === 'string' ? record.id : '';
      const existing = manager.get(id);
      if (!existing) {
        return textResult(`Scheduled task not found: ${id}`);
      }
      const updates: ScheduledTaskUpdateInput = {};
      if (typeof record.prompt === 'string' && record.prompt.trim()) {
        updates.prompt = record.prompt.trim();
      }
      if (typeof record.title === 'string' && record.title.trim()) {
        updates.title = record.title;
      }
      if (typeof record.cwd === 'string' && record.cwd.trim()) {
        updates.cwd = resolveCwd(record.cwd);
      }
      if (typeof record.enabled === 'boolean') {
        updates.enabled = record.enabled;
      }
      const kind = parseScheduleKind(record.schedule_kind);
      if (kind) {
        const fields = parseScheduleFields(kind, record, now());
        updates.scheduleConfig = fields.scheduleConfig;
        updates.repeatEvery = fields.repeatEvery;
        updates.repeatUnit = fields.repeatUnit;
        updates.runAt = fields.runAt as number;
        updates.nextRunAt = fields.runAt;
      } else if (record.run_at !== undefined) {
        const runAt = parseRunAt(record.run_at);
        if (runAt <= now()) {
          throw new Error('run_at must be in the future');
        }
        updates.runAt = runAt;
        updates.nextRunAt = runAt;
      }
      const updated = manager.update(id, updates);
      if (!updated) {
        return textResult(`Scheduled task not found: ${id}`);
      }
      return textResult(`Scheduled task updated:\n${formatTask(updated)}`);
    },
  };

  const deleteTool: ScheduleToolDefinition = {
    name: 'schedule_delete',
    label: 'schedule_delete',
    description: 'Delete a scheduled task permanently.',
    parameters: idParameters,
    async execute(_toolCallId, params) {
      const record = asRecord(params);
      const id = typeof record.id === 'string' ? record.id : '';
      const deleted = requireManager().delete(id);
      return textResult(
        deleted ? `Scheduled task deleted: ${id}` : `Scheduled task not found: ${id}`
      );
    },
  };

  const toggleTool: ScheduleToolDefinition = {
    name: 'schedule_toggle',
    label: 'schedule_toggle',
    description:
      'Enable or disable a scheduled task without deleting it. Disabling only blocks future automatic runs.',
    parameters: toggleParameters,
    async execute(_toolCallId, params) {
      const record = asRecord(params);
      const id = typeof record.id === 'string' ? record.id : '';
      const enabled = record.enabled === true;
      const updated = requireManager().toggle(id, enabled);
      if (!updated) {
        return textResult(`Scheduled task not found: ${id}`);
      }
      return textResult(`Scheduled task ${updated.enabled ? 'enabled' : 'disabled'}:\n${formatTask(updated)}`);
    },
  };

  const runNowTool: ScheduleToolDefinition = {
    name: 'schedule_run_now',
    label: 'schedule_run_now',
    description:
      'Trigger a scheduled task immediately: its prompt runs right away in a new agent session.',
    parameters: idParameters,
    async execute(_toolCallId, params) {
      const record = asRecord(params);
      const id = typeof record.id === 'string' ? record.id : '';
      const updated = await requireManager().runNow(id);
      if (!updated) {
        return textResult(`Scheduled task not found: ${id}`);
      }
      return textResult(`Scheduled task executed:\n${formatTask(updated)}`);
    },
  };

  return [listTool, createTool, updateTool, deleteTool, toggleTool, runNowTool];
}
