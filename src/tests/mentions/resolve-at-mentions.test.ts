import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyAttachedContextPrefix,
  resolveAtMentions,
} from '../../main/mentions/resolve-at-mentions';
import { AT_MENTION_FILE_BYTE_LIMIT } from '../../shared/at-mentions';
import { setBackendLanguage } from '../../main/i18n';

vi.mock('../../main/agent/http-request', () => ({
  executeHttpRequest: vi.fn(async ({ url }: { url: string }) => ({
    url,
    status: 200,
    contentType: 'text/plain',
    body: `fetched:${url}`,
    truncated: false,
  })),
  formatHttpRequestResult: (result: {
    url: string;
    status: number;
    contentType: string;
    body: string;
  }) =>
    `URL: ${result.url}\nStatus: ${result.status}\nContent-Type: ${result.contentType}\n\n${result.body}`,
}));

const tempDirs: string[] = [];

afterEach(async () => {
  setBackendLanguage('en');
  tempDirs.length = 0;
});

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'at-mentions-'));
  tempDirs.push(root);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await writeFile(path.join(root, 'src', 'hello.ts'), 'export const n = 1;\n', 'utf8');
  await writeFile(path.join(root, 'docs', 'note.md'), 'hello docs\n', 'utf8');
  return root;
}

describe('resolveAtMentions', () => {
  it('resolves a file mention with content prefixed as attached_context', async () => {
    const root = await makeWorkspace();
    const result = await resolveAtMentions('Look at @src/hello.ts', root);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.kind).toBe('file');
    expect(result.items[0]?.ok).toBe(true);
    expect(result.items[0]?.body).toContain('export const n = 1;');
    expect(result.prefix).toContain('<attached_context source="src/hello.ts">');
    expect(result.prefix).toContain('export const n = 1;');
    expect(applyAttachedContextPrefix('Look at @src/hello.ts', result.prefix)).toMatch(
      /^<attached_context[\s\S]*Look at @src\/hello\.ts$/
    );
  });

  it('truncates file content at the 64 KiB ceiling', async () => {
    const root = await makeWorkspace();
    const big = 'x'.repeat(AT_MENTION_FILE_BYTE_LIMIT + 128);
    await writeFile(path.join(root, 'src', 'big.txt'), big, 'utf8');

    const result = await resolveAtMentions('@src/big.txt', root);
    expect(result.items[0]?.ok).toBe(true);
    expect(result.items[0]?.body.length).toBeLessThan(big.length);
    expect(result.items[0]?.body).toContain('Truncated');
    expect(result.items[0]?.body.startsWith('x'.repeat(100))).toBe(true);
  });

  it('rejects path traversal without injecting a model prefix block', async () => {
    const root = await makeWorkspace();
    const result = await resolveAtMentions('bad @../outside.txt', root);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.ok).toBe(false);
    expect(result.items[0]?.body).toContain('Path escapes the workspace');
    expect(result.prefix).toBe('');
    expect(applyAttachedContextPrefix('bad @../outside.txt', result.prefix)).toBe(
      'bad @../outside.txt'
    );
  });

  it('rejects a workspace symlink that points outside the workspace', async () => {
    const root = await makeWorkspace();
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'at-mentions-outside-'));
    tempDirs.push(outsideDir);
    const outsideFile = path.join(outsideDir, 'secret.txt');
    await writeFile(outsideFile, 'secret-data\n', 'utf8');
    await symlink(outsideFile, path.join(root, 'src', 'leak.txt'));

    const result = await resolveAtMentions('@src/leak.txt', root);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.ok).toBe(false);
    expect(result.items[0]?.body).toContain('Path escapes the workspace');
    expect(result.prefix).toBe('');
    expect(result.prefix).not.toContain('secret-data');
  });

  it('lists one directory level for folder mentions', async () => {
    const root = await makeWorkspace();
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'src', 'nested', 'deep.ts'), 'deep\n', 'utf8');

    const result = await resolveAtMentions('tree @src', root);

    expect(result.items[0]?.kind).toBe('directory');
    expect(result.items[0]?.ok).toBe(true);
    const lines = result.items[0]?.body.split('\n') ?? [];
    expect(lines).toContain('hello.ts');
    expect(lines).toContain('nested/');
    expect(lines.join('\n')).not.toContain('deep.ts');
    expect(lines.join('\n')).not.toContain('docs');
  });

  it('keeps missing files as ok:false items without injecting prefix blocks', async () => {
    const root = await makeWorkspace();
    const result = await resolveAtMentions('@src/missing.ts', root);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.ok).toBe(false);
    expect(result.items[0]?.body.toLowerCase()).toMatch(/not found|introuvable|존재하지/);
    expect(result.prefix).toBe('');
    expect(result.prefix).not.toContain('<attached_context');
  });

  it('includes only successful items in the model prefix when mixed with failures', async () => {
    const root = await makeWorkspace();
    const result = await resolveAtMentions(
      'See @src/hello.ts and @src/missing.ts and @docs/note.md',
      root
    );

    expect(result.items).toHaveLength(3);
    expect(result.items.map((item) => item.ok)).toEqual([true, false, true]);
    expect(result.prefix).toContain('<attached_context source="src/hello.ts">');
    expect(result.prefix).toContain('<attached_context source="docs/note.md">');
    expect(result.prefix).not.toContain('src/missing.ts');
    expect(result.prefix).not.toContain('not found');
  });

  it('resolves URL mentions via web_fetch helper', async () => {
    const root = await makeWorkspace();
    const result = await resolveAtMentions('@https://example.com/a', root);
    expect(result.items[0]?.kind).toBe('url');
    expect(result.items[0]?.ok).toBe(true);
    expect(result.items[0]?.body).toContain('fetched:https://example.com/a');
  });
});
