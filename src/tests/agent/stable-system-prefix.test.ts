import { describe, expect, it } from 'vitest';
import { sortSkillsForStablePrefix } from '../../main/agent/stable-system-prefix';
import { coreMemoryToPromptBlock } from '../../main/memory/memory-utils';

describe('stable system prefix determinism', () => {
  it('sorts skills deterministically by name then path', () => {
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

  it('sorts core memory keys for stable memory blocks after the system prefix', () => {
    const blockA = coreMemoryToPromptBlock({ zeta: 'z', alpha: 'a', mu: 'm' });
    const blockB = coreMemoryToPromptBlock({ mu: 'm', alpha: 'a', zeta: 'z' });
    expect(blockA).toBe(blockB);
    expect(blockA).toBe('- alpha: a\n- mu: m\n- zeta: z');
  });
});
