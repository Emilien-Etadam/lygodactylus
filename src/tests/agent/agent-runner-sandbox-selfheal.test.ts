import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxBootstrapDeps } from '../../main/agent/agent-runner-sandbox-bootstrap';

const getSandboxExecutionBlockReason = vi.fn();
const checkWSLStatus = vi.fn();
const reinitializeSandbox = vi.fn();

vi.mock('../../main/sandbox/sandbox-execution-guard', () => ({
  getSandboxExecutionBlockReason: (...args: unknown[]) => getSandboxExecutionBlockReason(...args),
}));

// Keep the real pathConverter / describeWslUnavailableReason, override only the
// live probe so we can drive the self-heal branch deterministically.
vi.mock('../../main/sandbox/wsl-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../main/sandbox/wsl-bridge')>();
  return {
    ...actual,
    WSLBridge: { checkWSLStatus: (...args: unknown[]) => checkWSLStatus(...args) },
  };
});

vi.mock('../../main/sandbox/sandbox-adapter', () => ({
  reinitializeSandbox: (...args: unknown[]) => reinitializeSandbox(...args),
}));

vi.mock('../../main/sandbox/sandbox-sync', () => ({
  SandboxSync: { hasSession: vi.fn(() => false), initSync: vi.fn() },
}));

vi.mock('../../main/sandbox/lima-sync', () => ({
  LimaSync: { hasSession: vi.fn(() => false), initSync: vi.fn() },
}));

import { bootstrapSandboxEnvironment } from '../../main/agent/agent-runner-sandbox-bootstrap';

function makeDeps(overrides: Partial<SandboxBootstrapDeps> = {}): SandboxBootstrapDeps {
  return {
    sessionId: 'session-1',
    workingDir: '/workspace/project',
    thinkingStepId: 'trace-1',
    sandboxEnabled: true,
    sandbox: {
      isWSL: false,
      isLima: false,
      isBlocked: true,
      mode: 'blocked',
      wslStatus: undefined,
      limaStatus: undefined,
    } as SandboxBootstrapDeps['sandbox'],
    sendToRenderer: vi.fn(),
    sendMessage: vi.fn(),
    sendTraceUpdate: vi.fn(),
    getBuiltinSkillsPath: vi.fn(() => ''),
    getRuntimeSkillsDir: vi.fn(() => '/tmp/skills'),
    syncUserSkillsToAppDir: vi.fn(),
    syncConfiguredSkillsToRuntimeDir: vi.fn(),
    ...overrides,
  };
}

function blockedSandbox(
  extra: Record<string, unknown> = {}
): SandboxBootstrapDeps['sandbox'] {
  return {
    isWSL: false,
    isLima: false,
    isBlocked: true,
    mode: 'blocked',
    ...extra,
  } as SandboxBootstrapDeps['sandbox'];
}

function firstMessageText(deps: SandboxBootstrapDeps): string {
  const call = vi.mocked(deps.sendMessage).mock.calls[0];
  const message = call[1];
  return (message.content[0] as { text: string }).text;
}

const originalPlatform = process.platform;

describe('bootstrapSandboxEnvironment self-heal (Windows)', () => {
  beforeAll(() => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  });
  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  beforeEach(() => {
    getSandboxExecutionBlockReason.mockReset();
    checkWSLStatus.mockReset();
    reinitializeSandbox.mockReset();
    reinitializeSandbox.mockResolvedValue(undefined);
  });

  it('self-heals a stale WSL block and lets the run proceed', async () => {
    getSandboxExecutionBlockReason
      .mockReturnValueOnce('WSL2 is not installed. Run "wsl --install" ...')
      .mockReturnValueOnce(null);
    checkWSLStatus.mockResolvedValue({ available: true, distro: 'Ubuntu' });

    const deps = makeDeps({ sandbox: blockedSandbox() });
    const result = await bootstrapSandboxEnvironment(deps);

    expect(checkWSLStatus).toHaveBeenCalledTimes(1);
    expect(reinitializeSandbox).toHaveBeenCalledTimes(1);
    expect(result.aborted).toBe(false);
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('aborts with a cold-start message (no reinstall advice) when WSL is still not ready', async () => {
    getSandboxExecutionBlockReason.mockReturnValueOnce('stale not-installed reason');
    checkWSLStatus.mockResolvedValue({ available: false, reason: 'not-ready' });

    const deps = makeDeps({ sandbox: blockedSandbox() });
    const result = await bootstrapSandboxEnvironment(deps);

    expect(reinitializeSandbox).not.toHaveBeenCalled();
    expect(result.aborted).toBe(true);
    const text = firstMessageText(deps);
    expect(text).toMatch(/not responding yet/i);
    expect(text).not.toMatch(/wsl --install/);
  });

  it('keeps the install guidance when WSL2 is genuinely absent', async () => {
    getSandboxExecutionBlockReason.mockReturnValueOnce('stale reason');
    checkWSLStatus.mockResolvedValue({ available: false, reason: 'not-installed' });

    const deps = makeDeps({ sandbox: blockedSandbox() });
    const result = await bootstrapSandboxEnvironment(deps);

    expect(result.aborted).toBe(true);
    expect(firstMessageText(deps)).toMatch(/wsl --install/);
    expect(reinitializeSandbox).not.toHaveBeenCalled();
  });

  it('does not re-check WSL when the adapter is not blocked', async () => {
    getSandboxExecutionBlockReason.mockReturnValueOnce('some non-WSL block');
    const deps = makeDeps({
      sandbox: blockedSandbox({ isBlocked: false, mode: 'native' }),
    });

    const result = await bootstrapSandboxEnvironment(deps);

    expect(checkWSLStatus).not.toHaveBeenCalled();
    expect(result.aborted).toBe(true);
  });

  it('does not re-check WSL on non-Windows platforms', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      getSandboxExecutionBlockReason.mockReturnValueOnce('blocked reason');
      const deps = makeDeps({ sandbox: blockedSandbox() });

      const result = await bootstrapSandboxEnvironment(deps);

      expect(checkWSLStatus).not.toHaveBeenCalled();
      expect(result.aborted).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    }
  });
});
