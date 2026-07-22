/**
 * SDK contract — value exports imported by the app must exist with the expected typeof.
 * Cartography (étape 0): see PR description. Types-only imports are covered by tsc.
 *
 * Updated for pi SDK 0.81.1: AuthStorage left the public surface; ModelRuntime is the
 * replacement the app imports.
 */
import { describe, expect, it } from 'vitest';
import * as codingAgent from '@earendil-works/pi-coding-agent';
import * as piAiCompat from '@earendil-works/pi-ai/compat';
import * as piAi from '@earendil-works/pi-ai';

/** Runtime value symbols imported from @earendil-works/pi-coding-agent (src/main). */
const CODING_AGENT_VALUE_EXPORTS = [
  'createWriteToolDefinition',
  'createEditToolDefinition',
  'createBashToolDefinition',
  'createFindToolDefinition',
  'createGrepToolDefinition',
  'createAgentSession',
  'DefaultResourceLoader',
  'getAgentDir',
  'ModelRuntime',
  'SessionManager',
  'SettingsManager',
] as const;

/** Runtime value symbols imported from @earendil-works/pi-ai/compat (src/main). */
const PI_AI_COMPAT_VALUE_EXPORTS = [
  'getModel',
  'getModels',
  'completeSimple',
  'streamSimple',
] as const;

/** Runtime value symbols imported from @earendil-works/pi-ai (harness / credential fixtures). */
const PI_AI_VALUE_EXPORTS = ['InMemoryCredentialStore'] as const;

function assertFunctionExport(moduleName: string, exportName: string, value: unknown): void {
  expect(value, `${exportName} missing from ${moduleName}`).toBeTypeOf('function');
}

describe('sdk-contract exports (pi-coding-agent)', () => {
  for (const name of CODING_AGENT_VALUE_EXPORTS) {
    it(`${name} exists and is typeof function`, () => {
      assertFunctionExport('@earendil-works/pi-coding-agent', name, codingAgent[name]);
    });
  }

  it('AuthStorage is no longer a public export (breaking ≥0.80.8)', () => {
    expect(
      (codingAgent as Record<string, unknown>).AuthStorage,
      'AuthStorage unexpectedly re-exported — update app migration notes'
    ).toBeUndefined();
  });
});

describe('sdk-contract exports (pi-ai/compat)', () => {
  for (const name of PI_AI_COMPAT_VALUE_EXPORTS) {
    it(`${name} exists and is typeof function`, () => {
      assertFunctionExport('@earendil-works/pi-ai/compat', name, piAiCompat[name]);
    });
  }
});

describe('sdk-contract exports (pi-ai)', () => {
  for (const name of PI_AI_VALUE_EXPORTS) {
    it(`${name} exists and is typeof function`, () => {
      assertFunctionExport('@earendil-works/pi-ai', name, piAi[name]);
    });
  }
});
