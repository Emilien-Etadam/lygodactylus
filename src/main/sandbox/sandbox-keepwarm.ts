/**
 * @module main/sandbox/sandbox-keepwarm
 *
 * Keeps the sandbox VM (WSL2) warm with a low-frequency heartbeat while the app
 * runs. WSL2 shuts its utility VM down after an idle timeout, so a command — or
 * a scheduled task firing much later — otherwise pays a multi-second cold start
 * (the exact failure behind the "WSL2 is not installed" cold-probe bug). A cheap
 * periodic `wsl -d <distro> -e true` resets the idle timer and keeps it hot.
 *
 * The heartbeat trades a little idle RAM for no cold start and is gated by the
 * `sandboxKeepWarmEnabled` config flag (default on) at the call sites. The timing
 * service takes an injected warm function so it stays VM-agnostic and testable.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { log, logError } from '../utils/logger';

const execFileAsync = promisify(execFile);

export const DEFAULT_SANDBOX_KEEPWARM_INTERVAL_MS = 45_000;
const WARM_COMMAND_TIMEOUT_MS = 15_000;

export type WarmFn = () => Promise<void>;

function isValidDistroName(distro: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(distro);
}

/**
 * Build a warm-up function that cheaply pings the WSL VM (`wsl -d <distro> -e
 * true`). Returns null for an invalid distro name (never interpolated blindly).
 */
export function createWslWarmFn(distro: string): WarmFn | null {
  if (!isValidDistroName(distro)) {
    return null;
  }
  return async () => {
    await execFileAsync('wsl', ['-d', distro, '-e', 'true'], {
      timeout: WARM_COMMAND_TIMEOUT_MS,
      encoding: 'utf-8',
    });
  };
}

/**
 * Timing service: warms immediately, then on an interval. Never overlaps pings,
 * swallows ping errors, and unrefs its timer so it can never hold the process
 * open on quit. `start` is idempotent (it stops any prior heartbeat first).
 */
export class SandboxKeepWarm {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private warmFn: WarmFn | null = null;

  start(warmFn: WarmFn, intervalMs: number = DEFAULT_SANDBOX_KEEPWARM_INTERVAL_MS): void {
    this.stop();
    this.warmFn = warmFn;
    log(`[SandboxKeepWarm] Heartbeat started (every ${Math.round(intervalMs / 1000)}s)`);
    void this.tick(); // warm right away so the first command is hot
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log('[SandboxKeepWarm] Heartbeat stopped');
    }
    this.warmFn = null;
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  private async tick(): Promise<void> {
    if (this.inFlight || !this.warmFn) {
      return;
    }
    this.inFlight = true;
    try {
      await this.warmFn();
    } catch (error) {
      logError('[SandboxKeepWarm] Warm ping failed (non-fatal):', error);
    } finally {
      this.inFlight = false;
    }
  }
}

const instance = new SandboxKeepWarm();

export function startSandboxKeepWarm(warmFn: WarmFn, intervalMs?: number): void {
  instance.start(warmFn, intervalMs);
}

export function stopSandboxKeepWarm(): void {
  instance.stop();
}

export function isSandboxKeepWarmRunning(): boolean {
  return instance.isRunning();
}
