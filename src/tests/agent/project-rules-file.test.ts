import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROJECT_RULES_MAX_BYTES,
  PROJECT_RULES_TRUNCATION_MARKER,
  applyProjectRulesAgentsFilesOverride,
  resolveProjectRulesFile,
  truncateProjectRulesContent,
} from '../../main/agent/project-rules-file';

const tempRoots: string[] = [];

function makeTempWorkspace(prefix: string): string {
  const root = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('resolveProjectRulesFile', () => {
  it('prefers AGENTS.md over .rules and CLAUDE.md', () => {
    const workspace = makeTempWorkspace('project-rules-precedence');
    writeFileSync(join(workspace, 'AGENTS.md'), '# agents\n');
    writeFileSync(join(workspace, '.rules'), '# rules\n');
    writeFileSync(join(workspace, 'CLAUDE.md'), '# claude\n');

    const resolved = resolveProjectRulesFile(workspace);
    expect(resolved?.fileName).toBe('AGENTS.md');
    expect(resolved?.content).toBe('# agents\n');
    expect(resolved?.truncated).toBe(false);
  });

  it('falls back to .rules when AGENTS.md is absent', () => {
    const workspace = makeTempWorkspace('project-rules-dot-rules');
    writeFileSync(join(workspace, '.rules'), '# rules only\n');
    writeFileSync(join(workspace, 'CLAUDE.md'), '# claude\n');

    const resolved = resolveProjectRulesFile(workspace);
    expect(resolved?.fileName).toBe('.rules');
    expect(resolved?.content).toBe('# rules only\n');
  });

  it('falls back to CLAUDE.md when only that candidate exists', () => {
    const workspace = makeTempWorkspace('project-rules-claude');
    writeFileSync(join(workspace, 'CLAUDE.md'), '# claude only\n');

    const resolved = resolveProjectRulesFile(workspace);
    expect(resolved?.fileName).toBe('CLAUDE.md');
    expect(resolved?.content).toBe('# claude only\n');
  });

  it('returns null silently when no candidate exists', () => {
    const workspace = makeTempWorkspace('project-rules-absent');
    expect(resolveProjectRulesFile(workspace)).toBeNull();
    expect(resolveProjectRulesFile('')).toBeNull();
    expect(resolveProjectRulesFile('   ')).toBeNull();
  });
});

describe('truncateProjectRulesContent', () => {
  it('keeps content unchanged under the size cap', () => {
    const content = 'hello rules';
    expect(truncateProjectRulesContent(content)).toEqual({ content, truncated: false });
  });

  it('truncates oversized content with a stable marker within the byte budget', () => {
    const content = 'a'.repeat(PROJECT_RULES_MAX_BYTES + 128);
    const first = truncateProjectRulesContent(content);
    const second = truncateProjectRulesContent(content);

    expect(first.truncated).toBe(true);
    expect(first.content.endsWith(PROJECT_RULES_TRUNCATION_MARKER)).toBe(true);
    expect(Buffer.from(first.content, 'utf8').length).toBe(PROJECT_RULES_MAX_BYTES);
    expect(first.content).toBe(second.content);
  });

  it('does not split multi-byte UTF-8 characters at the cut point', () => {
    // é is 2 bytes in UTF-8; choose a budget that would land mid-character
    // without the continuation-byte walk-back.
    const content = `${'é'.repeat(40)}tail`;
    const truncated = truncateProjectRulesContent(content, 25);
    expect(truncated.truncated).toBe(true);
    expect(truncated.content.includes('\uFFFD')).toBe(false);
    expect(Buffer.from(truncated.content, 'utf8').toString('utf8')).toBe(truncated.content);
  });
});

describe('applyProjectRulesAgentsFilesOverride', () => {
  it('injects .rules when the SDK only discovered CLAUDE.md at the workspace root', () => {
    const workspace = makeTempWorkspace('project-rules-override-rules');
    writeFileSync(join(workspace, '.rules'), 'from-rules\n');
    writeFileSync(join(workspace, 'CLAUDE.md'), 'from-claude\n');

    const projectRules = resolveProjectRulesFile(workspace);
    expect(projectRules?.fileName).toBe('.rules');

    const merged = applyProjectRulesAgentsFilesOverride(
      [{ path: join(workspace, 'CLAUDE.md'), content: 'from-claude\n' }],
      workspace,
      projectRules
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.path).toBe(join(workspace, '.rules'));
    expect(merged[0]?.content).toBe('from-rules\n');
  });

  it('preserves ancestor agents files while replacing the workspace-root candidate', () => {
    const workspace = makeTempWorkspace('project-rules-override-ancestor');
    writeFileSync(join(workspace, 'AGENTS.md'), 'root-agents\n');
    const ancestorPath = join(tmpdir(), 'ancestor-AGENTS.md');

    const merged = applyProjectRulesAgentsFilesOverride(
      [
        { path: ancestorPath, content: 'ancestor\n' },
        { path: join(workspace, 'AGENTS.md'), content: 'sdk-root\n' },
      ],
      workspace,
      resolveProjectRulesFile(workspace)
    );

    expect(merged.map((file) => file.path)).toEqual(
      [ancestorPath, join(workspace, 'AGENTS.md')].sort((a, b) => a.localeCompare(b))
    );
    expect(merged.find((file) => file.path === join(workspace, 'AGENTS.md'))?.content).toBe(
      'root-agents\n'
    );
  });

  it('is byte-stable across two identical override passes', () => {
    const workspace = makeTempWorkspace('project-rules-stability');
    writeFileSync(join(workspace, 'AGENTS.md'), `${'stable-'.repeat(8000)}tail\n`);
    const projectRules = resolveProjectRulesFile(workspace);
    const base = [
      { path: join(workspace, 'AGENTS.md'), content: 'ignored-sdk\n' },
      { path: '/z/other.md', content: 'other\n' },
      { path: '/a/other.md', content: 'early\n' },
    ];

    const first = applyProjectRulesAgentsFilesOverride(base, workspace, projectRules);
    const second = applyProjectRulesAgentsFilesOverride(base, workspace, projectRules);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.map((file) => file.path)).toEqual(
      [...first.map((file) => file.path)].sort((a, b) => a.localeCompare(b))
    );
  });

  it('leaves the list untouched (sorted) when no project rules file exists', () => {
    const workspace = makeTempWorkspace('project-rules-override-empty');
    const merged = applyProjectRulesAgentsFilesOverride(
      [
        { path: '/b/AGENTS.md', content: 'b\n' },
        { path: '/a/AGENTS.md', content: 'a\n' },
      ],
      workspace,
      null
    );
    expect(merged.map((file) => file.path)).toEqual(['/a/AGENTS.md', '/b/AGENTS.md']);
  });
});
