import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SandboxKeepWarm, createWslWarmFn } from '../../main/sandbox/sandbox-keepwarm';

describe('createWslWarmFn', () => {
  it('returns a function for a valid distro name', () => {
    expect(typeof createWslWarmFn('Ubuntu')).toBe('function');
    expect(typeof createWslWarmFn('Ubuntu-22.04')).toBe('function');
  });

  it('returns null for an invalid / injection-prone distro name', () => {
    expect(createWslWarmFn('')).toBeNull();
    expect(createWslWarmFn('bad name')).toBeNull();
    expect(createWslWarmFn('Ubuntu; rm -rf /')).toBeNull();
    expect(createWslWarmFn('$(whoami)')).toBeNull();
  });
});

describe('SandboxKeepWarm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('warms immediately and then on each interval', async () => {
    const warm = vi.fn().mockResolvedValue(undefined);
    const keepWarm = new SandboxKeepWarm();

    keepWarm.start(warm, 1000);
    expect(warm).toHaveBeenCalledTimes(1); // immediate
    expect(keepWarm.isRunning()).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(warm).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(warm).toHaveBeenCalledTimes(3);

    keepWarm.stop();
  });

  it('stops warming after stop()', async () => {
    const warm = vi.fn().mockResolvedValue(undefined);
    const keepWarm = new SandboxKeepWarm();

    keepWarm.start(warm, 1000);
    keepWarm.stop();
    expect(keepWarm.isRunning()).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(warm).toHaveBeenCalledTimes(1); // only the immediate ping
  });

  it('never overlaps pings while one is in flight', async () => {
    let release!: () => void;
    const warm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const keepWarm = new SandboxKeepWarm();

    keepWarm.start(warm, 1000);
    expect(warm).toHaveBeenCalledTimes(1); // in flight, unresolved

    await vi.advanceTimersByTimeAsync(3000); // three ticks, all skipped
    expect(warm).toHaveBeenCalledTimes(1);

    release(); // let the in-flight ping finish
    await vi.advanceTimersByTimeAsync(1000);
    expect(warm).toHaveBeenCalledTimes(2);

    keepWarm.stop();
  });

  it('swallows ping errors and keeps beating', async () => {
    const warm = vi.fn().mockRejectedValue(new Error('cold vm'));
    const keepWarm = new SandboxKeepWarm();

    keepWarm.start(warm, 1000);
    expect(warm).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(warm).toHaveBeenCalledTimes(2); // did not throw / stop

    keepWarm.stop();
  });

  it('start() is idempotent — a second start replaces the first heartbeat', async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    const keepWarm = new SandboxKeepWarm();

    keepWarm.start(first, 1000);
    expect(first).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0); // let the first immediate ping settle

    keepWarm.start(second, 1000); // replaces the first heartbeat
    expect(second).toHaveBeenCalledTimes(1); // immediate
    await vi.advanceTimersByTimeAsync(2000);

    expect(first).toHaveBeenCalledTimes(1); // never called again
    expect(second).toHaveBeenCalledTimes(3); // immediate + 2 intervals
    keepWarm.stop();
  });
});
