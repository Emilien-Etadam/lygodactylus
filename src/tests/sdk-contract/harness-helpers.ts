/**
 * Shared offline fixtures for the SDK contract harness (pi-ai / pi-coding-agent).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Model } from '@earendil-works/pi-ai';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

export interface HarnessWorkspace {
  cwd: string;
  agentDir: string;
  cleanup: () => void;
}

export function createHarnessWorkspace(prefix = 'sdk-contract-'): HarnessWorkspace {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  const agentDir = mkdtempSync(join(tmpdir(), `${prefix}agent-`));
  return {
    cwd,
    agentDir,
    cleanup: () => {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(agentDir, { recursive: true, force: true });
    },
  };
}

/** Minimal synthetic model — no network, matches app buildSyntheticPiModel shape. */
export function createSyntheticPiModel(
  overrides: Partial<Model<'openai-completions'>> = {}
): Model<'openai-completions'> {
  return {
    id: 'sdk-contract-model',
    name: 'sdk-contract-model',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: 'http://127.0.0.1:9/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 1024,
    ...overrides,
  };
}

export function writeMinimalSkill(
  skillRoot: string,
  name: string,
  description = 'harness skill'
): void {
  mkdirSync(skillRoot, { recursive: true });
  writeFileSync(
    join(skillRoot, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`
  );
}

/** Offline ModelRuntime for harness sessions (no file auth, no network catalogs). */
export async function createHarnessModelRuntime(): Promise<ModelRuntime> {
  return ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    allowModelNetwork: false,
  });
}
