/**
 * SDK contract — byte-stable invariants that depend on the SDK session / prompt
 * assembly path. Reuses (moves) the SDK-facing cases from older test files;
 * non-SDK cases stay in their original suites.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { sortSkillsForStablePrefix } from '../../main/agent/stable-system-prefix';
import { buildPiSessionRuntimeSignature } from '../../main/agent/pi-session-runtime';
import {
  createHarnessModelRuntime,
  createHarnessWorkspace,
  createSyntheticPiModel,
  writeMinimalSkill,
  type HarnessWorkspace,
} from './harness-helpers';
import { join } from 'node:path';

describe('sdk-contract stable prefix — sortSkillsForStablePrefix', () => {
  it('sorts skills deterministically by name then path (skillsOverride input)', () => {
    const sorted = sortSkillsForStablePrefix([
      { name: 'b', description: 'b', filePath: '/b2' },
      { name: 'b', description: 'b', filePath: '/b1' },
      { name: 'a', description: 'a', filePath: '/a' },
    ]);
    expect(sorted.map((skill) => `${skill.name}:${skill.filePath}`)).toEqual([
      'a:/a',
      'b:/b1',
      'b:/b2',
    ]);
  });
});

describe('sdk-contract stable prefix — buildPiSessionRuntimeSignature', () => {
  it('keeps act-mode runtime signature identical when sessionMode is omitted or act', () => {
    const baseInput = {
      configProvider: 'openai',
      customProtocol: 'openai-completions',
      modelProvider: 'openai',
      modelApi: 'openai-completions',
      modelBaseUrl: 'http://localhost:11434/v1',
      effectiveCwd: '/tmp/ws',
      apiKey: 'secret',
    };
    const withoutMode = buildPiSessionRuntimeSignature(baseInput);
    const withAct = buildPiSessionRuntimeSignature({ ...baseInput, sessionMode: 'act' });
    const withPlan = buildPiSessionRuntimeSignature({ ...baseInput, sessionMode: 'plan' });

    expect(withAct).toBe(withoutMode);
    expect(withPlan).not.toBe(withoutMode);
    expect(withPlan).toContain('"sessionMode":"plan"');
  });

  it('is byte-stable across two identical calls', () => {
    const input = {
      configProvider: 'openai',
      customProtocol: 'openai-completions',
      modelProvider: 'openai',
      modelApi: 'openai-completions',
      modelBaseUrl: 'http://localhost:11434/v1/',
      effectiveCwd: '/tmp/ws',
      apiKey: 'secret',
    };
    expect(buildPiSessionRuntimeSignature(input)).toBe(buildPiSessionRuntimeSignature(input));
  });
});

describe('sdk-contract stable prefix — assembled system prompt', () => {
  let workspace: HarnessWorkspace | undefined;

  afterEach(() => {
    workspace?.cleanup();
    workspace = undefined;
  });

  it('is byte-stable across two sessions with identical loader overrides', async () => {
    workspace = createHarnessWorkspace();
    const { cwd, agentDir } = workspace;
    const skillRoot = join(cwd, 'skills', 'stable-skill');
    writeMinimalSkill(skillRoot, 'stable-skill');

    async function buildSystemPrompt(): Promise<string> {
      const modelRuntime = await createHarnessModelRuntime();
      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir,
        noExtensions: true,
        noThemes: true,
        noPromptTemplates: true,
        additionalSkillPaths: [skillRoot],
        skillsOverride: (base) => ({
          ...base,
          skills: sortSkillsForStablePrefix(base.skills),
        }),
        appendSystemPrompt: ['sdk-contract-stable-append'],
      });
      await resourceLoader.reload();

      const { session } = await createAgentSession({
        model: createSyntheticPiModel(),
        thinkingLevel: 'off',
        modelRuntime,
        sessionManager: SessionManager.inMemory(),
        settingsManager: SettingsManager.inMemory({}),
        resourceLoader,
        cwd,
      });
      try {
        return session.systemPrompt;
      } finally {
        session.dispose();
      }
    }

    const first = await buildSystemPrompt();
    const second = await buildSystemPrompt();
    expect(first.length).toBeGreaterThan(0);
    expect(first).toBe(second);
    expect(first).toContain('sdk-contract-stable-append');
  });
});
