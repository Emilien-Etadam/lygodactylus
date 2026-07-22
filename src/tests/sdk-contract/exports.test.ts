/**
 * SDK contract — value exports imported by the app must exist with the expected typeof.
 * Cartography (étape 0): see PR description. Types-only imports are covered by tsc.
 */
import { describe, expect, it } from 'vitest';
import * as codingAgent from '@earendil-works/pi-coding-agent';
import * as piAiCompat from '@earendil-works/pi-ai/compat';

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
  'AuthStorage',
  'ModelRegistry',
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

function assertFunctionExport(moduleName: string, exportName: string, value: unknown): void {
  expect(value, `${exportName} missing from ${moduleName}`).toBeTypeOf('function');
}

describe('sdk-contract exports (pi-coding-agent)', () => {
  for (const name of CODING_AGENT_VALUE_EXPORTS) {
    it(`${name} exists and is typeof function`, () => {
      assertFunctionExport('@earendil-works/pi-coding-agent', name, codingAgent[name]);
    });
  }
});

describe('sdk-contract exports (pi-ai/compat)', () => {
  for (const name of PI_AI_COMPAT_VALUE_EXPORTS) {
    it(`${name} exists and is typeof function`, () => {
      assertFunctionExport('@earendil-works/pi-ai/compat', name, piAiCompat[name]);
    });
  }
});
