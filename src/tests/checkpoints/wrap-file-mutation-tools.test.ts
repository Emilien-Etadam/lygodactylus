import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

const capturePath = vi.fn();
const resolveWorkspacePath = vi.fn((root: string, filePath: string) => `${root}/${filePath}`);

vi.mock('../../main/checkpoints/checkpoint-service', () => ({
  checkpointService: {
    capturePath: (...args: unknown[]) => capturePath(...args),
    resolveWorkspacePath: (root: string, filePath: string) => resolveWorkspacePath(root, filePath),
  },
}));

describe('wrapFileMutationToolsForCheckpoints', () => {
  beforeEach(() => {
    capturePath.mockReset();
    resolveWorkspacePath.mockClear();
  });

  it('captures before write/edit execute and leaves other tools untouched', async () => {
    const { wrapFileMutationToolsForCheckpoints } = await import(
      '../../main/checkpoints/wrap-file-mutation-tools'
    );

    const writeExecute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      details: undefined,
    }));
    const readExecute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'read' }],
      details: undefined,
    }));

    const tools = [
      {
        name: 'write',
        label: 'write',
        description: 'write',
        parameters: {},
        execute: writeExecute,
      },
      {
        name: 'edit',
        label: 'edit',
        description: 'edit',
        parameters: {},
        execute: vi.fn(async () => ({
          content: [{ type: 'text' as const, text: 'edited' }],
          details: undefined,
        })),
      },
      {
        name: 'read',
        label: 'read',
        description: 'read',
        parameters: {},
        execute: readExecute,
      },
    ] as unknown as ToolDefinition[];

    const wrapped = wrapFileMutationToolsForCheckpoints(tools, 'sess-1', '/workspace');
    expect(wrapped[2]).toBe(tools[2]);

    await wrapped[0]!.execute(
      'call-1',
      { path: 'a.ts', content: 'x' },
      undefined,
      undefined,
      {} as never
    );
    expect(capturePath).toHaveBeenCalledWith('sess-1', '/workspace/a.ts', 'write');
    expect(writeExecute).toHaveBeenCalledOnce();

    await wrapped[1]!.execute(
      'call-2',
      { path: 'b.ts', edits: [] },
      undefined,
      undefined,
      {} as never
    );
    expect(capturePath).toHaveBeenCalledWith('sess-1', '/workspace/b.ts', 'edit');
  });
});
