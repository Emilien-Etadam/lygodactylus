import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess, SpawnOptions } from 'child_process';
import {
  createWslSandboxBashOperations,
  resetWslSandboxBashSessionsForTests,
} from '../../main/agent/wsl-sandbox-bash-operations';

const MARKER_READY = '__OCOWORK_BASH_READY__';
const MARKER_DONE = '__OCOWORK_BASH_DONE__';
const MARKER_EXIT = '__OCOWORK_BASH_EXIT:';

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
  stdin = {
    write: vi.fn((script: string, cb?: (error?: Error | null) => void) => {
      if (script.includes(MARKER_READY)) {
        this.stdout.emit('data', Buffer.from(`${MARKER_READY}\n`));
      } else if (script.includes('source') || script.includes('set +m')) {
        // Shell init lines produce no stdout, like real bash.
      } else if (script.includes('pwd')) {
        this.stdout.emit(
          'data',
          Buffer.from(`/home/ubuntu/.claude/sandbox/session-1\n${MARKER_EXIT}0\n${MARKER_DONE}\n`)
        );
      } else {
        this.stdout.emit('data', Buffer.from(`${MARKER_EXIT}0\n${MARKER_DONE}\n`));
      }
      cb?.(null);
      return true;
    }),
  };

  constructor(readonly pid = 4242) {
    super();
  }
}

function createSpawnMock(child: FakeChildProcess) {
  return vi.fn((command: string, args: string[], _options: SpawnOptions) => {
    return Object.assign(child, {
      spawnargs: [command, ...args],
      spawnfile: command,
      killed: false,
      connected: false,
      exitCode: null,
      signalCode: null,
    }) as unknown as ChildProcess;
  });
}

describe('wsl sandbox bash operations', () => {
  const sandboxPath = '/home/ubuntu/.claude/sandbox/session-1';

  afterEach(() => {
    resetWslSandboxBashSessionsForTests();
    vi.restoreAllMocks();
  });

  it('reuses a persistent WSL bash session across commands', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock(child);
    const ops = createWslSandboxBashOperations({
      distro: 'Ubuntu-24.04',
      sandboxPath,
      spawnProcess,
    });

    const chunks: Buffer[] = [];
    await ops.exec('pwd', '/workspace', {
      onData: (chunk) => chunks.push(chunk as Buffer),
      signal: undefined,
      timeout: 30,
      env: undefined,
    });
    await ops.exec('echo ok', '/workspace', {
      onData: () => undefined,
      signal: undefined,
      timeout: 30,
      env: undefined,
    });

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    const [, args] = spawnProcess.mock.calls[0]!;
    expect(args).toEqual(['-d', 'Ubuntu-24.04', '-e', 'bash', '--noprofile', '--norc']);
    expect(Buffer.concat(chunks).toString()).toContain(sandboxPath);
  });

  it('parses CRLF markers from WSL output', async () => {
    const child = new FakeChildProcess();
    const originalWrite = child.stdin.write;
    child.stdin.write = vi.fn((script: string, cb?: (error?: Error | null) => void) => {
      if (script.includes(MARKER_READY)) {
        child.stdout.emit('data', Buffer.from(`${MARKER_READY}\r\n`));
      } else if (script.includes('source') || script.includes('set +m')) {
        // Shell init lines produce no stdout, like real bash.
      } else {
        child.stdout.emit(
          'data',
          Buffer.from('test\r\n__OCOWORK_BASH_EXIT:0\r\n__OCOWORK_BASH_DONE__\r\n')
        );
      }
      cb?.(null);
      return true;
    }) as typeof originalWrite;

    const ops = createWslSandboxBashOperations({
      distro: 'Ubuntu-24.04',
      sandboxPath,
      spawnProcess: createSpawnMock(child),
    });

    const chunks: Buffer[] = [];
    const result = await ops.exec('echo test', '/workspace', {
      onData: (chunk) => chunks.push(chunk as Buffer),
      signal: undefined,
      timeout: 30,
      env: undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(Buffer.concat(chunks).toString()).toContain('test');
  });

  it('does not let a slow WSL cold boot consume the command timeout budget', async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChildProcess();
      child.stdin.write = vi.fn((script: string, cb?: (error?: Error | null) => void) => {
        if (script.includes(MARKER_READY)) {
          // Simulate a slow WSL2 cold boot: the shell only becomes ready
          // after 6s, longer than the 5s command timeout used below.
          setTimeout(() => {
            child.stdout.emit('data', Buffer.from(`${MARKER_READY}\n`));
          }, 6000);
        } else if (script.includes('source') || script.includes('set +m')) {
          // Shell init lines produce no stdout, like real bash.
        } else {
          child.stdout.emit('data', Buffer.from(`${MARKER_EXIT}0\n${MARKER_DONE}\n`));
        }
        cb?.(null);
        return true;
      });

      const ops = createWslSandboxBashOperations({
        distro: 'Ubuntu-24.04',
        sandboxPath,
        spawnProcess: createSpawnMock(child),
      });

      const resultPromise = ops.exec('echo test', '/workspace', {
        onData: () => undefined,
        signal: undefined,
        timeout: 5,
        env: undefined,
      });

      await vi.advanceTimersByTimeAsync(6000);
      const result = await resultPromise;

      expect(result.exitCode).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects aborted commands', async () => {
    const child = new FakeChildProcess();
    const controller = new AbortController();
    controller.abort();

    const ops = createWslSandboxBashOperations({
      distro: 'Ubuntu-24.04',
      sandboxPath,
      spawnProcess: createSpawnMock(child),
    });

    await expect(
      ops.exec('pwd', sandboxPath, {
        onData: () => undefined,
        signal: controller.signal,
        timeout: undefined,
        env: undefined,
      })
    ).rejects.toThrow('aborted');
  });
});
