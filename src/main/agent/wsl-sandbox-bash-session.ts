import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import {
  resolveSandboxBashCwd,
  rewriteVirtualWorkspacePaths,
  shellEscapePosixPath,
} from '../sandbox/sandbox-workspace-path';
import { getSandboxNetworkProxy } from '../sandbox/sandbox-network-proxy';
import { configStore } from '../config/config-store';
import { logError } from '../utils/logger';

const MARKER_DONE = '__OCOWORK_BASH_DONE__';
const MARKER_EXIT_PREFIX = '__OCOWORK_BASH_EXIT:';
const MARKER_READY = '__OCOWORK_BASH_READY__';
const DEFAULT_TERMINATION_GRACE_MS = 5000;
const WSL_STARTUP_TIMEOUT_MS = 30_000;

type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface WslSandboxBashSessionOptions {
  distro: string;
  sandboxPath: string;
  virtualWorkspacePath?: string;
  spawnProcess?: SpawnProcess;
  terminationGraceMs?: number;
}

interface ExecRequest {
  command: string;
  cwd: string;
  onData: (chunk: string | Uint8Array) => void;
  signal?: AbortSignal;
  timeout?: number;
}

function validateDistroName(distro: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(distro)) {
    throw new Error(`Invalid WSL distro name: ${distro}`);
  }
}

function createSpawnProcess(): SpawnProcess {
  return (command, args, options) => spawn(command, args, options);
}

async function waitForProcessClose(child: ChildProcess, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      child.off('close', finish);
      child.off('error', finish);
      resolve();
    };
    child.once('close', finish);
    child.once('error', finish);
    const timeoutHandle = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore cleanup failures.
      }
      finish();
    }, timeoutMs);
    timeoutHandle.unref?.();
  });
}

async function killWslProcessTree(
  pid: number,
  spawnProcess: SpawnProcess,
  taskkillWaitMs: number
): Promise<void> {
  try {
    const taskkill = spawnProcess('taskkill', ['/F', '/T', '/PID', String(pid)], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitForProcessClose(taskkill, taskkillWaitMs);
  } catch {
    try {
      process.kill(pid);
    } catch {
      // Process may already be gone.
    }
  }
}

class WslSandboxBashSession {
  private child: ChildProcess | null = null;
  private readonly queue: Array<{
    request: ExecRequest;
    resolve: (value: { exitCode: number | null }) => void;
    reject: (error: Error) => void;
  }> = [];
  private active:
    | {
        request: ExecRequest;
        resolve: (value: { exitCode: number | null }) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  private activeTimeout: NodeJS.Timeout | undefined;
  private buffer = '';
  private disposed = false;
  private draining = false;
  private proxyConfigured = false;
  private readyState: { resolve: () => void; reject: (error: Error) => void } | undefined;

  constructor(
    private readonly options: Required<
      Pick<WslSandboxBashSessionOptions, 'distro' | 'sandboxPath' | 'virtualWorkspacePath'>
    > & {
      spawnProcess: SpawnProcess;
      terminationGraceMs: number;
    }
  ) {}

  exec(
    command: string,
    cwd: string,
    {
      onData,
      signal,
      timeout,
    }: {
      onData: (chunk: string | Uint8Array) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    }
  ): Promise<{ exitCode: number | null }> {
    if (this.disposed) {
      return Promise.reject(new Error('WSL bash session disposed'));
    }
    if (signal?.aborted) {
      return Promise.reject(new Error('aborted'));
    }

    return new Promise((resolve, reject) => {
      const entry = {
        request: { command, cwd, onData, signal, timeout },
        resolve,
        reject,
      };

      signal?.addEventListener(
        'abort',
        () => {
          if (this.active === entry) {
            void this.terminateActive('aborted');
            return;
          }
          const index = this.queue.indexOf(entry);
          if (index >= 0) {
            this.queue.splice(index, 1);
          }
          reject(new Error('aborted'));
        },
        { once: true }
      );

      this.queue.push(entry);
      void this.pumpQueue();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.queue.splice(0).forEach((entry) => entry.reject(new Error('aborted')));
    if (this.active) {
      this.active.reject(new Error('aborted'));
      this.active = undefined;
    }
    if (this.proxyConfigured) {
      void getSandboxNetworkProxy().release();
      this.proxyConfigured = false;
    }
    void this.stopChild();
  }

  private async pumpQueue(): Promise<void> {
    if (this.draining || this.active || this.queue.length === 0 || this.disposed) {
      return;
    }

    this.draining = true;
    while (this.queue.length > 0 && !this.disposed) {
      const entry = this.queue.shift();
      if (!entry) {
        break;
      }

      this.active = entry;
      try {
        await this.ensureChild();
        // Arm the command timeout only once the shell is ready — cold WSL
        // boots are bounded separately by WSL_STARTUP_TIMEOUT_MS and must
        // not eat into the caller's per-command timeout budget.
        if (entry.request.timeout !== undefined && entry.request.timeout > 0) {
          this.activeTimeout = setTimeout(() => {
            void this.terminateActive('timeout', entry.request.timeout);
          }, entry.request.timeout * 1000);
        }
        this.buffer = '';
        await this.runActiveCommand(entry);
      } catch (error) {
        entry.reject(error instanceof Error ? error : new Error(String(error)));
        await this.stopChild();
      } finally {
        if (this.activeTimeout) {
          clearTimeout(this.activeTimeout);
          this.activeTimeout = undefined;
        }
        this.active = undefined;
      }
    }
    this.draining = false;
  }

  private async ensureChild(): Promise<void> {
    if (this.child && !this.child.killed) {
      return;
    }

    await Promise.race([
      this.startChild(),
      new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new Error('WSL bash session startup timed out'));
        }, WSL_STARTUP_TIMEOUT_MS).unref?.();
      }),
    ]);
  }

  private async startChild(): Promise<void> {
    const child = this.options.spawnProcess(
      'wsl',
      ['-d', this.options.distro, '-e', 'bash', '--noprofile', '--norc'],
      {
        detached: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );

    if (!child.stdin || !child.stdout || !child.stderr) {
      throw new Error('Failed to start persistent WSL bash session');
    }

    child.stdout.on('data', (chunk) => this.handleOutput(chunk));
    child.stderr.on('data', (chunk) => this.handleOutput(chunk));
    child.once('close', () => {
      this.child = null;
      this.proxyConfigured = false;
      const error = new Error('WSL bash session closed unexpectedly');
      this.readyState?.reject(error);
      this.readyState = undefined;
      if (this.active) {
        this.active.reject(error);
        this.active = undefined;
      }
      this.queue.splice(0).forEach((entry) => entry.reject(error));
    });
    child.once('error', (error) => {
      this.readyState?.reject(error);
      this.readyState = undefined;
      if (this.active) {
        this.active.reject(error);
        this.active = undefined;
      }
    });

    this.child = child;
    this.buffer = '';
    const ready = new Promise<void>((resolve, reject) => {
      this.readyState = { resolve, reject };
    });
    child.stdin.write('source ~/.nvm/nvm.sh 2>/dev/null\n');
    child.stdin.write('set +m\n');
    // LAN proxy is optional — never block bash startup on it.
    void this.ensureSandboxNetworkProxy();
    // Wait for bash to actually be alive and reading stdin (WSL2 cold boot
    // can take several seconds) before signaling the session as usable —
    // this is what WSL_STARTUP_TIMEOUT_MS bounds, kept separate from the
    // caller's per-command timeout.
    child.stdin.write(`echo ${MARKER_READY}\n`);
    await ready;
  }

  private async ensureSandboxNetworkProxy(): Promise<void> {
    if (
      this.proxyConfigured ||
      process.platform !== 'win32' ||
      !configStore.get('sandboxLanNetworkEnabled') ||
      !this.child?.stdin
    ) {
      return;
    }

    try {
      const proxy = getSandboxNetworkProxy();
      const proxyUrl = await proxy.acquire(this.options.distro);
      const setupScript = proxy.buildBashSetupScript();
      if (!proxyUrl || !setupScript || !this.child?.stdin) {
        return;
      }

      this.child.stdin.write(`${setupScript}\n`);
      this.proxyConfigured = true;
    } catch (error) {
      // LAN proxy is optional; bash must keep working when binding fails (e.g. WSL mirrored DNS IP).
      logError('[WslSandboxBashSession] Failed to configure sandbox LAN network proxy:', error);
    }
  }

  private handleOutput(chunk: Buffer): void {
    if (this.readyState) {
      this.buffer += chunk.toString().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (this.buffer.includes(MARKER_READY)) {
        this.buffer = '';
        const { resolve } = this.readyState;
        this.readyState = undefined;
        resolve();
      }
      return;
    }

    const active = this.active;
    if (!active) {
      return;
    }

    active.request.onData(chunk);
    this.buffer += chunk.toString().replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const doneIndex = this.findDoneMarkerIndex(this.buffer);
    if (doneIndex < 0) {
      return;
    }

    const doneTokenLength = this.buffer
      .slice(doneIndex)
      .startsWith(`\n${MARKER_DONE}\n`)
      ? `\n${MARKER_DONE}\n`.length
      : `\n${MARKER_DONE}`.length;
    const beforeDone = this.buffer.slice(0, doneIndex);
    this.buffer = this.buffer.slice(doneIndex + doneTokenLength);

    const exitMatch = beforeDone.match(new RegExp(`${MARKER_EXIT_PREFIX}(\\d+)\\s*$`, 'm'));
    const exitCode = exitMatch ? Number.parseInt(exitMatch[1] ?? '1', 10) : 1;

    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = undefined;
    }

    active.resolve({ exitCode });
  }

  private findDoneMarkerIndex(buffer: string): number {
    const withTrailingNewline = buffer.indexOf(`\n${MARKER_DONE}\n`);
    if (withTrailingNewline >= 0) {
      return withTrailingNewline;
    }

    const atEnd = buffer.lastIndexOf(`\n${MARKER_DONE}`);
    if (atEnd < 0) {
      return -1;
    }

    const afterMarker = buffer.slice(atEnd + `\n${MARKER_DONE}`.length);
    return afterMarker.length === 0 || afterMarker.startsWith('\n') ? atEnd : -1;
  }

  private runActiveCommand(entry: {
    request: ExecRequest;
    resolve: (value: { exitCode: number | null }) => void;
    reject: (error: Error) => void;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin) {
        reject(new Error('WSL bash session is not ready'));
        return;
      }

      const wrappedResolve = entry.resolve;
      const wrappedReject = entry.reject;
      entry.resolve = (value) => {
        wrappedResolve(value);
        resolve();
      };
      entry.reject = (error) => {
        wrappedReject(error);
        reject(error);
      };

      const wslCwd = resolveSandboxBashCwd(
        entry.request.cwd,
        this.options.sandboxPath,
        this.options.virtualWorkspacePath
      );
      const rewrittenCommand = rewriteVirtualWorkspacePaths(
        entry.request.command,
        this.options.sandboxPath,
        this.options.virtualWorkspacePath
      );
      const escapedCwd = shellEscapePosixPath(wslCwd);
      const script = [
        `{ cd '${escapedCwd}' || { echo '${MARKER_EXIT_PREFIX}1'; echo '${MARKER_DONE}'; exit 0; };`,
        rewrittenCommand,
        `echo "${MARKER_EXIT_PREFIX}$?"`,
        `echo "${MARKER_DONE}"`,
        '}',
      ].join(' ');

      this.child.stdin.write(`${script}\n`, (error) => {
        if (error) {
          reject(error);
        }
      });
    });
  }

  private async terminateActive(
    reason: 'aborted' | 'timeout',
    timeoutSeconds?: number
  ): Promise<void> {
    const active = this.active;
    if (!active) {
      return;
    }

    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = undefined;
    }

    this.active = undefined;
    await this.stopChild();

    active.reject(
      reason === 'timeout'
        ? new Error(`timeout:${timeoutSeconds ?? active.request.timeout}`)
        : new Error('aborted')
    );
    void this.pumpQueue();
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.buffer = '';
    if (!child) {
      return;
    }
    if (child.pid) {
      await killWslProcessTree(
        child.pid,
        this.options.spawnProcess,
        this.options.terminationGraceMs
      );
    }
  }
}

const sessionPool = new Map<string, WslSandboxBashSession>();

function getSessionKey(distro: string, sandboxPath: string): string {
  return `${distro}::${sandboxPath}`;
}

export function getWslSandboxBashSession(
  options: WslSandboxBashSessionOptions
): WslSandboxBashSession {
  validateDistroName(options.distro);
  const key = getSessionKey(options.distro, options.sandboxPath);
  const existing = sessionPool.get(key);
  if (existing) {
    return existing;
  }

  const session = new WslSandboxBashSession({
    distro: options.distro,
    sandboxPath: options.sandboxPath,
    virtualWorkspacePath: options.virtualWorkspacePath ?? '/workspace',
    spawnProcess: options.spawnProcess ?? createSpawnProcess(),
    terminationGraceMs: options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
  });
  sessionPool.set(key, session);
  return session;
}

export function disposeWslSandboxBashSession(distro: string, sandboxPath: string): void {
  const key = getSessionKey(distro, sandboxPath);
  const session = sessionPool.get(key);
  if (!session) {
    return;
  }
  session.dispose();
  sessionPool.delete(key);
}

/** @internal Test helper */
export function resetWslSandboxBashSessionsForTests(): void {
  for (const session of sessionPool.values()) {
    session.dispose();
  }
  sessionPool.clear();
}
