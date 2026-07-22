/**
 * OfficeCLI curated skill — pinned install (no floating curl|bash / irm|iex).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const skillPath = path.resolve(process.cwd(), 'catalog/skills/officecli/SKILL.md');
const noticePath = path.resolve(process.cwd(), 'catalog/skills/officecli/NOTICE.md');

describe('officecli vendored skill — pinned binary install', () => {
  it('drops floating installers and pins v1.0.140 with sha256 digests', () => {
    const skill = readFileSync(skillPath, 'utf8');
    const notice = readFileSync(noticePath, 'utf8');

    expect(skill).not.toContain('d.officecli.ai');
    expect(skill).not.toContain('| bash');
    expect(skill).not.toContain('| iex');
    expect(skill).toContain('v1.0.140');

    const sha256 = skill.match(/[a-f0-9]{64}/g) ?? [];
    expect(sha256.length).toBeGreaterThanOrEqual(4);
    // Required platforms from prompt M4
    expect(skill).toContain('officecli-linux-x64');
    expect(skill).toContain('officecli-mac-arm64');
    expect(skill).toContain('officecli-mac-x64');
    expect(skill).toContain('officecli-win-x64.exe');

    expect(notice).toContain('v1.0.140');
    expect(notice).toContain('Local modifications');
    expect(notice).toMatch(/[a-f0-9]{40}/); // upstream commit SHA
  });
});
