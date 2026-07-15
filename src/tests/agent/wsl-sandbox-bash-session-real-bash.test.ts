import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createWslSandboxBashOperations,
  resetWslSandboxBashSessionsForTests,
} from '../../main/agent/wsl-sandbox-bash-operations';

/**
 * Integration tests against a REAL bash process (not a mocked child).
 *
 * The unit tests in wsl-sandbox-bash-operations.test.ts fake the child process
 * and emit the completion markers themselves, so they cannot catch shell
 * syntax errors in the script the session writes to stdin — which is exactly
 * how a malformed script (space-joined markers) wedged the persistent shell
 * and made every sandbox bash command time out. These tests drive the real
 * script through `bash --noprofile --norc` by substituting the `wsl` spawn.
 */

const isWindows = process.platform === 'win32';

function createRealBashSpawn() {
  return (command: string, args: string[], options: SpawnOptions): ChildProcess => {
    if (command === 'wsl') {
      return spawn('bash', ['--noprofile', '--norc'], options);
    }
    if (command === 'taskkill') {
      const pid = Number(args[args.indexOf('/PID') + 1]);
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Process already gone.
      }
      return spawn('true', [], options);
    }
    return spawn(command, args, options);
  };
}

describe.skipIf(isWindows)('wsl sandbox bash session against real bash', () => {
  let sandboxPath: string;

  beforeEach(() => {
    sandboxPath = mkdtempSync(join(tmpdir(), 'lygo-bash-real-'));
  });

  afterEach(() => {
    resetWslSandboxBashSessionsForTests();
    rmSync(sandboxPath, { recursive: true, force: true });
  });

  function createOps() {
    return createWslSandboxBashOperations({
      distro: 'Ubuntu-24.04',
      sandboxPath,
      spawnProcess: createRealBashSpawn(),
    });
  }

  async function exec(
    ops: ReturnType<typeof createOps>,
    command: string,
    { cwd = '/workspace', timeout = 15 }: { cwd?: string; timeout?: number } = {}
  ) {
    const chunks: Buffer[] = [];
    const result = await ops.exec(command, cwd, {
      onData: (chunk) => chunks.push(Buffer.from(chunk)),
      signal: undefined,
      timeout,
      env: undefined,
    });
    return { ...result, output: Buffer.concat(chunks).toString() };
  }

  it('runs a simple command and reports its output and exit code', async () => {
    const ops = createOps();
    const { exitCode, output } = await exec(ops, 'echo "test"');
    expect(exitCode).toBe(0);
    expect(output).toContain('test');
  });

  it('reports non-zero exit codes', async () => {
    const ops = createOps();
    const { exitCode } = await exec(ops, 'false');
    expect(exitCode).toBe(1);
  });

  it('handles pipes without swallowing the completion markers', async () => {
    const ops = createOps();
    const { exitCode, output } = await exec(ops, "printf 'a\\nb\\nc\\n' | tail -1");
    expect(exitCode).toBe(0);
    expect(output).toContain('c');
  });

  it('keeps shell state across commands in the same session', async () => {
    const ops = createOps();
    await exec(ops, 'export LYGO_REAL_BASH_TEST=42');
    const { exitCode, output } = await exec(ops, 'echo "value=$LYGO_REAL_BASH_TEST"');
    expect(exitCode).toBe(0);
    expect(output).toContain('value=42');
  });

  it('resolves the virtual workspace cwd to the sandbox directory', async () => {
    const ops = createOps();
    const { exitCode, output } = await exec(ops, 'pwd');
    expect(exitCode).toBe(0);
    expect(output).toContain(sandboxPath);
  });

  it('survives a cd failure and keeps serving later commands', async () => {
    const ops = createOps();
    const failed = await exec(ops, 'echo hi', { cwd: '/workspace/does-not-exist' });
    expect(failed.exitCode).toBe(1);

    mkdirSync(join(sandboxPath, 'sub'));
    const ok = await exec(ops, 'pwd', { cwd: '/workspace/sub' });
    expect(ok.exitCode).toBe(0);
    expect(ok.output).toContain(join(sandboxPath, 'sub'));
  });

  it('times out a hung command and recovers on the next one', async () => {
    const ops = createOps();
    await expect(exec(ops, 'sleep 30', { timeout: 1 })).rejects.toThrow('timeout:1');

    const { exitCode, output } = await exec(ops, 'echo "recovered"');
    expect(exitCode).toBe(0);
    expect(output).toContain('recovered');
  });
});
