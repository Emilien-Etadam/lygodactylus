import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const CJK = /[\u4e00-\u9fff]/;
const ROOT = join(__dirname, '../../..');
const SOURCE_ROOTS = ['src', 'extension', 'catalog'].map((dir) => join(ROOT, dir));

/** Paths where CJK is intentional (locale tables, NLP, language picker label). */
const ALLOWLIST_SUFFIXES = [
  '/renderer/i18n/locales/zh.json',
  '/main/i18n/catalog.ts',
  '/main/memory/memory-utils.ts',
  '/main/mcp/gui-operate/constants.ts',
  '/main/mcp/gui-operate/click-history.ts',
  '/main/memory/memory-eval-harness.ts',
  '/renderer/components/settings/SettingsGeneral.tsx',
];

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.html']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'out') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    const ext = entry.includes('.') ? `.${entry.split('.').pop()}` : '';
    if (CODE_EXTENSIONS.has(ext)) out.push(full);
  }
  return out;
}

function isAllowlisted(relPosix: string): boolean {
  return ALLOWLIST_SUFFIXES.some((suffix) => relPosix.endsWith(suffix));
}

describe('no hardcoded CJK in UI/runtime source', () => {
  it('forbids Chinese characters outside intentional locale/linguistic files', () => {
    const violations: string[] = [];

    for (const root of SOURCE_ROOTS) {
      for (const file of walk(root)) {
        const rel = relative(ROOT, file).split('\\').join('/');
        if (isAllowlisted(`/${rel}`) || isAllowlisted(rel)) continue;
        // Test fixtures under src/tests may contain Chinese sample data.
        if (rel.includes('/tests/') || rel.startsWith('src/tests/')) continue;

        const lines = readFileSync(file, 'utf8').split(/\r?\n/);
        lines.forEach((line, index) => {
          const stripped = line.trim();
          // Comments are not user-facing; skip them so this guard stays focused on UI leaks.
          if (
            stripped.startsWith('//') ||
            stripped.startsWith('*') ||
            stripped.startsWith('/*') ||
            stripped.startsWith('*/')
          ) {
            return;
          }
          if (!CJK.test(line)) return;
          violations.push(`${rel}:${index + 1}: ${stripped.slice(0, 120)}`);
        });
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
