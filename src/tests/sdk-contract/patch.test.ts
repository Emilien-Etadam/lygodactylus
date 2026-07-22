/**
 * SDK contract — DeepSeek V4 patch marker must remain applied in pi-ai until
 * upstream integrates it (then delete patches/ + this test).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PATCH_MARKER = 'requiresThinkingInContent';
const OPENAI_COMPLETIONS_REL =
  'node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js';

describe('sdk-contract patch — DeepSeek V4 (pi-ai)', () => {
  it('keeps requiresThinkingInContent in openai-completions.js (patch applied)', () => {
    const target = join(process.cwd(), OPENAI_COMPLETIONS_REL);
    expect(existsSync(target), `missing ${OPENAI_COMPLETIONS_REL}`).toBe(true);
    const source = readFileSync(target, 'utf8');
    expect(source).toContain(PATCH_MARKER);
  });

  it('documents the patch file present for the locked baseline version', () => {
    const patchPath = join(
      process.cwd(),
      'patches/@earendil-works+pi-ai+0.80.3.patch'
    );
    expect(existsSync(patchPath), 'expected DeepSeek V4 patch for 0.80.3').toBe(true);
    const patch = readFileSync(patchPath, 'utf8');
    expect(patch).toContain(PATCH_MARKER);
  });
});
