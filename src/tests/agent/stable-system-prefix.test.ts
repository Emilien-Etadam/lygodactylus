import { describe, expect, it } from 'vitest';
import { coreMemoryToPromptBlock } from '../../main/memory/memory-utils';

// SDK-facing skill sort invariant moved to src/tests/sdk-contract/stable-prefix.test.ts

describe('stable system prefix determinism', () => {
  it('sorts core memory keys for stable memory blocks after the system prefix', () => {
    const blockA = coreMemoryToPromptBlock({ zeta: 'z', alpha: 'a', mu: 'm' });
    const blockB = coreMemoryToPromptBlock({ mu: 'm', alpha: 'a', zeta: 'z' });
    expect(blockA).toBe(blockB);
    expect(blockA).toBe('- alpha: a\n- mu: m\n- zeta: z');
  });
});
