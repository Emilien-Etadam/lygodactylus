/**
 * SDK contract — defensive app behavior when the private `_onPayload` agent surface
 * is missing. Protects graceful degradation of the Ollama keep_alive/num_ctx wrapper,
 * not the upstream private API itself.
 *
 * Baseline 0.81.1: the SDK agent exposes public `onPayload`, not `_onPayload`.
 * createPiSession must warn and skip the wrapper without throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHarnessModelRuntime,
  createHarnessWorkspace,
  createSyntheticPiModel,
  type HarnessWorkspace,
} from './harness-helpers';

const logWarn = vi.hoisted(() => vi.fn());

vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: (...args: unknown[]) => logWarn(...args),
  logError: vi.fn(),
  logCtx: vi.fn(),
  logCtxWarn: vi.fn(),
  logCtxError: vi.fn(),
  logTiming: vi.fn(),
}));

vi.mock('../../main/config/config-store', () => ({
  configStore: {
    get: vi.fn(() => undefined),
  },
}));

import { createPiSession } from '../../main/agent/agent-runner-pi-session';
import type { AgentRunnerRunContext } from '../../main/agent/agent-runner-run-context';

let workspace: HarnessWorkspace | undefined;

function makeMinimalCtx(): AgentRunnerRunContext {
  return {
    renderer: {} as AgentRunnerRunContext['renderer'],
    pathResolver: {} as AgentRunnerRunContext['pathResolver'],
    activeControllers: new Map(),
    piSessions: new Map(),
    skillsPaths: {} as AgentRunnerRunContext['skillsPaths'],
    getToolDisplayName: (name) => name,
    getCurrentModelString: () => 'sdk-contract-model',
    getMcpServersCache: () => null,
    setMcpServersCache: () => undefined,
    isSkillsSetupDone: () => true,
    setSkillsSetupDone: () => undefined,
  };
}

beforeEach(() => {
  logWarn.mockClear();
});

afterEach(() => {
  workspace?.cleanup();
  workspace = undefined;
});

describe('sdk-contract private surface — _onPayload defensive degradation', () => {
  it('does not throw and logs a warn when the agent has no _onPayload (Ollama path)', async () => {
    workspace = createHarnessWorkspace();
    const { cwd } = workspace;
    const modelRuntime = await createHarnessModelRuntime();
    const ctx = makeMinimalCtx();
    const piModel = createSyntheticPiModel({
      baseUrl: 'http://127.0.0.1:11434/v1',
    });

    const result = await createPiSession({
      ctx,
      sessionId: 'sdk-contract-private-surface',
      provider: 'ollama',
      piModel,
      thinkingLevel: 'off',
      modelRuntime,
      customTools: [],
      skillPaths: [],
      promptTemplatePaths: [],
      coworkAppendPrompt: [],
      effectiveCwd: cwd,
      sessionRuntimeSignature: '{"test":true}',
      skillsSignature: '',
      modelContextWindow: 8192,
      modelMaxTokens: 1024,
    });

    expect(result.piSession).toBeDefined();
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('does not expose _onPayload')
    );

    // Confirm the live agent really lacks the private surface (documents baseline).
    const agent = result.piSession.agent as object;
    expect('_onPayload' in agent).toBe(false);

    result.piSession.dispose();
  });
});
