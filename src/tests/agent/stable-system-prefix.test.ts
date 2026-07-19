import { describe, expect, it } from 'vitest';
import {
  assembleStableSystemPrefix,
  sortSkillsForStablePrefix,
} from '../../main/agent/stable-system-prefix';
import { coreMemoryToPromptBlock } from '../../main/memory/memory-utils';

describe('stable system prefix determinism', () => {
  it('builds a byte-identical prefix for the same inputs', () => {
    const input = {
      appendSections: [
        'You are an Lygodactylus assistant.',
        '<workspace_info>Your current workspace is: /tmp/demo</workspace_info>',
        '<tool_behavior>Prefer http_request for LAN APIs.</tool_behavior>',
      ],
      skills: [
        {
          name: 'zebra',
          description: 'Z skill',
          filePath: '/skills/zebra/SKILL.md',
        },
        {
          name: 'alpha',
          description: 'A skill',
          filePath: '/skills/alpha/SKILL.md',
        },
      ],
      projectContextFiles: [
        { path: 'b.md', content: 'second' },
        { path: 'a.md', content: 'first' },
      ],
    };

    const first = assembleStableSystemPrefix(input);
    const second = assembleStableSystemPrefix({
      ...input,
      skills: [...input.skills].reverse(),
      projectContextFiles: [...input.projectContextFiles].reverse(),
    });

    expect(first).toBe(second);
    expect(first).toContain('<name>alpha</name>');
    expect(first.indexOf('<name>alpha</name>')).toBeLessThan(first.indexOf('<name>zebra</name>'));
    expect(first.indexOf('path="a.md"')).toBeLessThan(first.indexOf('path="b.md"'));
  });

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
