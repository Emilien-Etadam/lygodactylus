/**
 * SDK contract — extension points the app relies on (resource loader overrides,
 * excludeTools, customTools replacing builtins, StreamOptions.onPayload).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Type } from 'typebox';
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { Api, Model, StreamOptions } from '@earendil-works/pi-ai';
import {
  createHarnessWorkspace,
  createSyntheticPiModel,
  writeMinimalSkill,
  type HarnessWorkspace,
} from './harness-helpers';

type DefaultResourceLoaderOptions = ConstructorParameters<typeof DefaultResourceLoader>[0];
type SkillsOverride = NonNullable<DefaultResourceLoaderOptions['skillsOverride']>;
type AgentsFilesOverride = NonNullable<DefaultResourceLoaderOptions['agentsFilesOverride']>;
type StreamOnPayload = NonNullable<StreamOptions['onPayload']>;

let workspace: HarnessWorkspace | undefined;

afterEach(() => {
  workspace?.cleanup();
  workspace = undefined;
});

async function createPreparedSession(options: {
  customTools?: ToolDefinition[];
  excludeTools?: string[];
  skillName?: string;
  skillsOverride?: DefaultResourceLoaderOptions['skillsOverride'];
  agentsFilesOverride?: DefaultResourceLoaderOptions['agentsFilesOverride'];
}) {
  workspace = createHarnessWorkspace();
  const { cwd, agentDir } = workspace;
  const authStorage = AuthStorage.inMemory();
  const model = createSyntheticPiModel();

  const skillPaths: string[] = [];
  if (options.skillName) {
    const skillRoot = join(cwd, 'skills', options.skillName);
    writeMinimalSkill(skillRoot, options.skillName);
    skillPaths.push(skillRoot);
  }

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noThemes: true,
    noPromptTemplates: true,
    ...(skillPaths.length === 0 ? { noSkills: true } : { additionalSkillPaths: skillPaths }),
    ...(options.skillsOverride ? { skillsOverride: options.skillsOverride } : {}),
    ...(options.agentsFilesOverride ? { agentsFilesOverride: options.agentsFilesOverride } : {}),
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    model,
    thinkingLevel: 'off',
    authStorage,
    modelRegistry: ModelRegistry.create(authStorage),
    customTools: options.customTools,
    ...(options.excludeTools && options.excludeTools.length > 0
      ? { excludeTools: options.excludeTools }
      : {}),
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({}),
    resourceLoader,
    cwd,
  });

  return { session, resourceLoader, cwd };
}

describe('sdk-contract extension points — resource loader', () => {
  it('honors skillsOverride (fixture minimale)', async () => {
    const override: SkillsOverride = (base) => ({
      skills: base.skills.map((skill) =>
        skill.name === 'alpha-skill' ? { ...skill, name: 'alpha-skill-overridden' } : skill
      ),
      diagnostics: base.diagnostics,
    });
    const overrideSpy = vi.fn(override);

    const { session, resourceLoader } = await createPreparedSession({
      skillName: 'alpha-skill',
      skillsOverride: overrideSpy,
    });

    expect(overrideSpy).toHaveBeenCalled();
    const names = resourceLoader.getSkills().skills.map((skill) => skill.name);
    expect(names).toContain('alpha-skill-overridden');
    expect(names).not.toContain('alpha-skill');
    session.dispose();
  });

  it('honors agentsFilesOverride (fixture minimale)', async () => {
    const markerPath = '/virtual/AGENTS.override.md';
    const markerContent = 'sdk-contract-agents-override';
    const override: AgentsFilesOverride = (base) => ({
      agentsFiles: [...base.agentsFiles, { path: markerPath, content: markerContent }],
    });
    const overrideSpy = vi.fn(override);

    const { session, resourceLoader } = await createPreparedSession({
      agentsFilesOverride: overrideSpy,
    });

    expect(overrideSpy).toHaveBeenCalled();
    const files = resourceLoader.getAgentsFiles().agentsFiles;
    expect(files.some((file) => file.path === markerPath && file.content === markerContent)).toBe(
      true
    );
    session.dispose();
  });
});

describe('sdk-contract extension points — excludeTools / customTools', () => {
  it('accepts excludeTools and removes the builtin from the effective tool list', async () => {
    const { session } = await createPreparedSession({ excludeTools: ['write'] });
    const active = session.getActiveToolNames();
    expect(active).not.toContain('write');
    expect(active).toContain('bash');
    session.dispose();
  });

  it('replaces a builtin when customTools registers the same name (bash)', async () => {
    const replacementDescription = 'sdk-contract-replacement-bash';
    const customBash = {
      name: 'bash',
      label: 'bash',
      description: replacementDescription,
      parameters: Type.Object({ command: Type.String() }),
      async execute() {
        return { content: [{ type: 'text' as const, text: 'custom' }], details: {} };
      },
    } satisfies ToolDefinition;

    const { session } = await createPreparedSession({ customTools: [customBash] });
    const def = session.getToolDefinition('bash');
    expect(def?.description).toBe(replacementDescription);
    const info = session.getAllTools().find((tool) => tool.name === 'bash');
    expect(info?.sourceInfo?.source).toBe('sdk');
    session.dispose();
  });
});

describe('sdk-contract extension points — StreamOptions.onPayload', () => {
  it('is declared on pi-ai StreamOptions (types surface)', () => {
    const typesPath = join(process.cwd(), 'node_modules/@earendil-works/pi-ai/dist/types.d.ts');
    const source = readFileSync(typesPath, 'utf8');
    expect(source).toMatch(/onPayload\?:\s*\(payload:\s*unknown/);

    const options: StreamOptions = {
      onPayload: (payload) => payload,
    };
    expect(typeof options.onPayload).toBe('function');
  });

  it('is invoked on a light offline stream mock (mirrors openai-completions call site)', async () => {
    // Same contract as @earendil-works/pi-ai/dist/api/openai-completions.js:
    //   const nextParams = await options?.onPayload?.(params, model);
    interface ChatParams {
      model: string;
      messages: Array<{ role: string }>;
      patchedByOnPayload?: boolean;
    }

    const onPayloadImpl: StreamOnPayload = async (payload, _model: Model<Api>) => {
      const record = payload as ChatParams;
      return { ...record, patchedByOnPayload: true };
    };
    const onPayload = vi.fn(onPayloadImpl);

    const options: StreamOptions = { onPayload };
    let params: ChatParams = { model: 'sdk-contract-model', messages: [] };
    const model = createSyntheticPiModel();
    const nextParams = await options.onPayload?.(params, model);
    if (nextParams !== undefined) {
      params = nextParams as ChatParams;
    }

    expect(onPayload).toHaveBeenCalledOnce();
    expect(onPayload.mock.calls[0]?.[0]).toEqual({
      model: 'sdk-contract-model',
      messages: [],
    });
    expect(params).toEqual({
      model: 'sdk-contract-model',
      messages: [],
      patchedByOnPayload: true,
    });
  });
});
