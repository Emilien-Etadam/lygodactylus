import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { CatalogEntry } from '../src/shared/catalog-types';

// Entries resolving into this repository are validated against the working
// tree: at PR time the subdir does not exist on `main` yet, but the manifest
// on `main` and the subdir land in the same merge, so local presence is the
// meaningful check.
const SELF_REPO = 'emilien-etadam/lygodactylus';

async function githubSubdirExists(repo: string, subdir: string, ref: string): Promise<boolean> {
  if (repo.toLowerCase() === SELF_REPO) {
    const localPath = path.resolve(process.cwd(), subdir);
    return fs.existsSync(localPath) && fs.statSync(localPath).isDirectory();
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'lygodactylus-catalog-validator',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents/${subdir}?ref=${encodeURIComponent(ref)}`,
    {
      headers,
    }
  );
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`GitHub API error for ${repo}/${subdir}@${ref}: ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  if (Array.isArray(payload)) {
    return payload.length > 0 && payload.every((item) => item && typeof item === 'object');
  }
  return (
    typeof payload === 'object' && payload !== null && (payload as { type?: string }).type === 'dir'
  );
}

describe('catalog github resolve paths', () => {
  const manifestPath = path.resolve(process.cwd(), 'catalog/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    entries: CatalogEntry[];
  };

  const githubEntries = manifest.entries.filter(
    (
      entry
    ): entry is CatalogEntry & {
      resolve: { via: 'github'; repo: string; subdir: string; ref: string };
    } => entry.resolve.via === 'github'
  );

  it('has at least one github entry to validate', () => {
    expect(githubEntries.length).toBeGreaterThan(0);
  });

  it.each(
    githubEntries.map(
      (entry) => [entry.id, entry.resolve.repo, entry.resolve.subdir, entry.resolve.ref] as const
    )
  )(
    'entry %s resolves to an existing GitHub directory (%s/%s@%s)',
    async (_id, repo, subdir, ref) => {
      const exists = await githubSubdirExists(repo, subdir, ref);
      expect(exists).toBe(true);
    },
    30_000
  );
});
