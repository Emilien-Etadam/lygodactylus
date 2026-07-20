import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { wrapFileMutationToolsForCareful } from '../../main/autonomy/careful-approval';
import { clearCarefulAllowRun } from '../../main/autonomy/careful-run-allow';

describe('wrapFileMutationToolsForCareful', () => {
  const sessionId = 'sess-careful';
  let tmpDir: string;
  let targetFile: string;

  beforeEach(() => {
    clearCarefulAllowRun(sessionId);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'careful-'));
    targetFile = path.join(tmpDir, 'a.ts');
    fs.writeFileSync(targetFile, 'old\n', 'utf8');
  });

  it('on deny returns an explicit tool error and does not call original execute', async () => {
    const writeExecute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'written' }],
      details: undefined,
    }));
    const requestPermission = vi.fn(async () => 'deny' as const);

    const tools = [
      {
        name: 'write',
        label: 'write',
        description: 'write',
        parameters: {},
        execute: writeExecute,
      },
    ] as unknown as ToolDefinition[];

    const wrapped = wrapFileMutationToolsForCareful(
      tools,
      sessionId,
      tmpDir,
      () => 'careful',
      requestPermission
    );

    const result = await wrapped[0]!.execute(
      'call-1',
      { path: 'a.ts', content: 'new\n' },
      undefined,
      undefined,
      {} as never
    );

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(writeExecute).not.toHaveBeenCalled();
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? '';
    expect(text).toMatch(/denied/i);
    expect(text).toMatch(/careful/i);
  });

  it('on allow proceeds to original execute with a diff payload', async () => {
    const writeExecute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'written' }],
      details: undefined,
    }));
    const requestPermission = vi.fn(async () => 'allow' as const);

    const tools = [
      {
        name: 'write',
        label: 'write',
        description: 'write',
        parameters: {},
        execute: writeExecute,
      },
    ] as unknown as ToolDefinition[];

    const wrapped = wrapFileMutationToolsForCareful(
      tools,
      sessionId,
      tmpDir,
      () => 'careful',
      requestPermission
    );

    await wrapped[0]!.execute(
      'call-1',
      { path: 'a.ts', content: 'new\n' },
      undefined,
      undefined,
      {} as never
    );

    expect(writeExecute).toHaveBeenCalledOnce();
    const call = requestPermission.mock.calls[0] as unknown as [
      string,
      string,
      string,
      Record<string, unknown>,
      { diff?: { unifiedDiff?: string; path?: string }; allowRunOption?: boolean },
    ];
    const options = call[4];
    expect(options?.allowRunOption).toBe(true);
    expect(options?.diff?.path).toBe('a.ts');
    expect(options?.diff?.unifiedDiff).toContain('--- a/a.ts');
    expect(options?.diff?.unifiedDiff).toContain('+new');
  });

  it('allow_run skips subsequent asks in the same run', async () => {
    const writeExecute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'written' }],
      details: undefined,
    }));
    const requestPermission = vi.fn(async () => 'allow_run' as const);

    const tools = [
      {
        name: 'write',
        label: 'write',
        description: 'write',
        parameters: {},
        execute: writeExecute,
      },
    ] as unknown as ToolDefinition[];

    const wrapped = wrapFileMutationToolsForCareful(
      tools,
      sessionId,
      tmpDir,
      () => 'careful',
      requestPermission
    );

    await wrapped[0]!.execute(
      'c1',
      { path: 'a.ts', content: 'one\n' },
      undefined,
      undefined,
      {} as never
    );
    await wrapped[0]!.execute(
      'c2',
      { path: 'a.ts', content: 'two\n' },
      undefined,
      undefined,
      {} as never
    );

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(writeExecute).toHaveBeenCalledTimes(2);
  });

  it('normal autonomy does not intercept', async () => {
    const writeExecute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'written' }],
      details: undefined,
    }));
    const requestPermission = vi.fn(async () => 'deny' as const);

    const tools = [
      {
        name: 'write',
        label: 'write',
        description: 'write',
        parameters: {},
        execute: writeExecute,
      },
    ] as unknown as ToolDefinition[];

    const wrapped = wrapFileMutationToolsForCareful(
      tools,
      sessionId,
      tmpDir,
      () => 'normal',
      requestPermission
    );

    await wrapped[0]!.execute(
      'c1',
      { path: 'a.ts', content: 'x' },
      undefined,
      undefined,
      {} as never
    );
    expect(requestPermission).not.toHaveBeenCalled();
    expect(writeExecute).toHaveBeenCalledOnce();
  });
});
