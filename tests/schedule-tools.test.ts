import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  createScheduleTools,
  type ScheduleToolsManager,
} from '../src/main/schedule/schedule-tools';
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskUpdateInput,
} from '../src/main/schedule/scheduled-task-manager';

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0, 0).getTime();

function createFakeManager(initialTasks: ScheduledTask[] = []) {
  const tasks = new Map<string, ScheduledTask>(initialTasks.map((task) => [task.id, task]));
  let nextId = 1;
  const manager: ScheduleToolsManager = {
    list: () => Array.from(tasks.values()),
    get: (id) => tasks.get(id) ?? null,
    create: (input: ScheduledTaskCreateInput) => {
      const task: ScheduledTask = {
        id: `task-${nextId++}`,
        title: input.title ?? input.prompt.slice(0, 20),
        prompt: input.prompt,
        cwd: input.cwd,
        runAt: input.runAt,
        nextRunAt: input.nextRunAt ?? input.runAt,
        scheduleConfig: input.scheduleConfig ?? null,
        repeatEvery: input.repeatEvery ?? null,
        repeatUnit: input.repeatUnit ?? null,
        enabled: input.enabled ?? true,
        lastRunAt: null,
        lastRunSessionId: null,
        lastError: null,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      };
      tasks.set(task.id, task);
      return task;
    },
    update: (id: string, updates: ScheduledTaskUpdateInput) => {
      const current = tasks.get(id);
      if (!current) return null;
      const updated: ScheduledTask = {
        ...current,
        ...Object.fromEntries(
          Object.entries(updates).filter(([, value]) => value !== undefined)
        ),
        updatedAt: FIXED_NOW,
      };
      tasks.set(id, updated);
      return updated;
    },
    delete: (id) => tasks.delete(id),
    toggle: (id, enabled) => {
      const current = tasks.get(id);
      if (!current) return null;
      const updated = { ...current, enabled };
      tasks.set(id, updated);
      return updated;
    },
    runNow: async (id) => {
      const current = tasks.get(id);
      if (!current) return null;
      const updated = { ...current, lastRunAt: FIXED_NOW };
      tasks.set(id, updated);
      return updated;
    },
  };
  return { manager, tasks };
}

function buildTools(
  manager: ScheduleToolsManager,
  options: { unsupportedCwd?: string } = {}
) {
  return createScheduleTools({
    getManager: () => manager,
    defaultCwd: '/workspace/project',
    getCwdUnsupportedReason: (cwd) =>
      options.unsupportedCwd && cwd === options.unsupportedCwd ? 'Unsupported workspace path' : null,
    now: () => FIXED_NOW,
  });
}

function getTool(tools: ReturnType<typeof createScheduleTools>, name: string) {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

async function runTool(
  tools: ReturnType<typeof createScheduleTools>,
  name: string,
  params: unknown
): Promise<string> {
  const result = await getTool(tools, name).execute('call-1', params as never, undefined as never);
  return (result.content[0] as { text: string }).text;
}

describe('schedule tools', () => {
  it('exposes the full schedule management surface', () => {
    const { manager } = createFakeManager();
    const tools = buildTools(manager);
    expect(tools.map((tool) => tool.name)).toEqual([
      'schedule_list',
      'schedule_create',
      'schedule_update',
      'schedule_delete',
      'schedule_toggle',
      'schedule_run_now',
    ]);
  });

  it('lists tasks with rule and next run', async () => {
    const { manager } = createFakeManager();
    const tools = buildTools(manager);
    expect(await runTool(tools, 'schedule_list', {})).toContain('No scheduled tasks configured');

    await runTool(tools, 'schedule_create', {
      prompt: 'Daily standup summary',
      schedule_kind: 'daily',
      times: ['08:00'],
    });
    const text = await runTool(tools, 'schedule_list', {});
    expect(text).toContain('1 scheduled task(s)');
    expect(text).toContain('rule: daily at 08:00');
    expect(text).toContain('cwd: /workspace/project');
  });

  it('creates a one-shot task with a future run_at', async () => {
    const { manager, tasks } = createFakeManager();
    const tools = buildTools(manager);
    const text = await runTool(tools, 'schedule_create', {
      prompt: 'Backup notes',
      run_at: '2026-07-14T08:00',
    });
    expect(text).toContain('Scheduled task created');
    const task = Array.from(tasks.values())[0];
    expect(task.runAt).toBe(new Date(2026, 6, 14, 8, 0, 0, 0).getTime());
    expect(task.nextRunAt).toBe(task.runAt);
    expect(task.scheduleConfig).toBeNull();
    expect(task.enabled).toBe(true);
  });

  it('rejects a one-shot task in the past', async () => {
    const { manager } = createFakeManager();
    const tools = buildTools(manager);
    await expect(
      runTool(tools, 'schedule_create', { prompt: 'Too late', run_at: '2026-07-13T08:00' })
    ).rejects.toThrow('run_at must be in the future');
  });

  it('computes next run for weekly schedules and validates weekdays', async () => {
    const { manager, tasks } = createFakeManager();
    const tools = buildTools(manager);
    await expect(
      runTool(tools, 'schedule_create', {
        prompt: 'Weekly report',
        schedule_kind: 'weekly',
        times: ['09:00'],
      })
    ).rejects.toThrow('weekdays is required');

    await runTool(tools, 'schedule_create', {
      prompt: 'Weekly report',
      schedule_kind: 'weekly',
      times: ['09:00'],
      weekdays: [1],
    });
    const task = Array.from(tasks.values())[0];
    expect(task.scheduleConfig).toEqual({ kind: 'weekly', weekdays: [1], times: ['09:00'] });
    // FIXED_NOW is Monday 2026-07-13 12:00 local, so next Monday 09:00 is July 20.
    expect(task.nextRunAt).toBe(new Date(2026, 6, 20, 9, 0, 0, 0).getTime());
  });

  it('requires repeat fields for interval schedules', async () => {
    const { manager } = createFakeManager();
    const tools = buildTools(manager);
    await expect(
      runTool(tools, 'schedule_create', {
        prompt: 'Poll feed',
        schedule_kind: 'interval',
        run_at: '2026-07-14T08:00',
      })
    ).rejects.toThrow('repeat_every and repeat_unit are required');
  });

  it('rejects unsupported working directories', async () => {
    const { manager } = createFakeManager();
    const tools = buildTools(manager, { unsupportedCwd: '/bad/path' });
    await expect(
      runTool(tools, 'schedule_create', {
        prompt: 'Nope',
        run_at: '2026-07-14T08:00',
        cwd: '/bad/path',
      })
    ).rejects.toThrow('Unsupported workspace path');
  });

  it('updates prompt and reschedules with run_at', async () => {
    const { manager, tasks } = createFakeManager();
    const tools = buildTools(manager);
    await runTool(tools, 'schedule_create', { prompt: 'Old prompt', run_at: '2026-07-14T08:00' });
    const id = Array.from(tasks.keys())[0];
    const text = await runTool(tools, 'schedule_update', {
      id,
      prompt: 'New prompt',
      run_at: '2026-07-15T10:30',
    });
    expect(text).toContain('Scheduled task updated');
    const task = tasks.get(id)!;
    expect(task.prompt).toBe('New prompt');
    expect(task.nextRunAt).toBe(new Date(2026, 6, 15, 10, 30, 0, 0).getTime());
  });

  it('toggles, runs, and deletes tasks by id', async () => {
    const { manager, tasks } = createFakeManager();
    const tools = buildTools(manager);
    await runTool(tools, 'schedule_create', { prompt: 'Task', run_at: '2026-07-14T08:00' });
    const id = Array.from(tasks.keys())[0];

    expect(await runTool(tools, 'schedule_toggle', { id, enabled: false })).toContain('disabled');
    expect(tasks.get(id)!.enabled).toBe(false);

    expect(await runTool(tools, 'schedule_run_now', { id })).toContain('Scheduled task executed');
    expect(tasks.get(id)!.lastRunAt).toBe(FIXED_NOW);

    expect(await runTool(tools, 'schedule_delete', { id })).toContain('Scheduled task deleted');
    expect(tasks.size).toBe(0);
    expect(await runTool(tools, 'schedule_delete', { id })).toContain('not found');
  });

  it('reports missing manager as an explicit error', async () => {
    const tools = createScheduleTools({ getManager: () => null, now: () => FIXED_NOW });
    await expect(runTool(tools, 'schedule_list', {})).rejects.toThrow(
      'Scheduled task manager not initialized'
    );
  });
});

describe('schedule tools wiring', () => {
  const piSetupContent = readFileSync(
    path.resolve(process.cwd(), 'src/main/agent/agent-runner-pi-setup.ts'),
    'utf8'
  );

  it('is registered in the pi session setup', () => {
    expect(piSetupContent).toContain('createScheduleTools');
    expect(piSetupContent).toContain('mainAppState.scheduledTaskManager');
    expect(piSetupContent).toContain('...scheduleCustomTools');
    expect(piSetupContent).toContain('getWorkspacePathUnsupportedReason');
  });
});
