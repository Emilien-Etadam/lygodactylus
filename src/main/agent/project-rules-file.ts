/**
 * Project rules file resolution for workspace-root context injection.
 *
 * The pi-coding-agent SDK already discovers AGENTS.md / CLAUDE.md from cwd
 * (and ancestors). This module extends that with `.rules`, enforces a size
 * cap, and applies a documented first-match precedence at the workspace root.
 *
 * Precedence (first existing readable file wins):
 *   AGENTS.md > AGENTS.MD > .rules > CLAUDE.md > CLAUDE.MD
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export const PROJECT_RULES_MAX_BYTES = 32 * 1024;

/** Appended when content is truncated to stay within PROJECT_RULES_MAX_BYTES. */
export const PROJECT_RULES_TRUNCATION_MARKER = '\n\n[...truncated...]';

/**
 * Candidate file names at the workspace root, in precedence order.
 * AGENTS.MD / CLAUDE.MD match the SDK's case variants.
 */
export const PROJECT_RULES_CANDIDATES = [
  'AGENTS.md',
  'AGENTS.MD',
  '.rules',
  'CLAUDE.md',
  'CLAUDE.MD',
] as const;

const PROJECT_RULES_CANDIDATE_SET: ReadonlySet<string> = new Set(PROJECT_RULES_CANDIDATES);

export interface ProjectRulesFile {
  path: string;
  fileName: string;
  content: string;
  truncated: boolean;
}

export interface AgentsFileEntry {
  path: string;
  content: string;
}

/**
 * Truncate UTF-8 content to at most `maxBytes`, appending a stable marker.
 * Byte-stable: same input always yields the same output.
 */
export function truncateProjectRulesContent(
  content: string,
  maxBytes: number = PROJECT_RULES_MAX_BYTES
): { content: string; truncated: boolean } {
  if (maxBytes < 0) {
    throw new Error('maxBytes must be non-negative');
  }

  const raw = Buffer.from(content, 'utf8');
  if (raw.length <= maxBytes) {
    return { content, truncated: false };
  }

  const markerBuf = Buffer.from(PROJECT_RULES_TRUNCATION_MARKER, 'utf8');
  const budget = Math.max(0, maxBytes - markerBuf.length);
  let end = budget;
  // Do not split a multi-byte UTF-8 sequence.
  while (end > 0 && end < raw.length && (raw[end]! & 0xc0) === 0x80) {
    end -= 1;
  }

  return {
    content: Buffer.concat([raw.subarray(0, end), markerBuf]).toString('utf8'),
    truncated: true,
  };
}

/**
 * Resolve the workspace-root project rules file.
 * Missing / unreadable candidates are skipped silently; null if none match.
 */
export function resolveProjectRulesFile(workspaceDir: string): ProjectRulesFile | null {
  const trimmed = workspaceDir.trim();
  if (!trimmed) {
    return null;
  }

  const root = resolve(trimmed);
  for (const fileName of PROJECT_RULES_CANDIDATES) {
    const filePath = join(root, fileName);
    try {
      if (!existsSync(filePath)) {
        continue;
      }
      const stats = statSync(filePath);
      if (!stats.isFile()) {
        continue;
      }
      const raw = readFileSync(filePath, 'utf8');
      const { content, truncated } = truncateProjectRulesContent(raw);
      return { path: filePath, fileName, content, truncated };
    } catch {
      // Unreadable candidate: try the next one (absent = silence).
      continue;
    }
  }

  return null;
}

function isWorkspaceRootCandidate(filePath: string, workspaceDir: string): boolean {
  const name = basename(filePath);
  if (!PROJECT_RULES_CANDIDATE_SET.has(name)) {
    return false;
  }
  return resolve(dirname(filePath)) === resolve(workspaceDir);
}

/**
 * Merge SDK-discovered agents files with our workspace-root resolution:
 * replace any root-level AGENTS/CLAUDE candidates with the first-match file
 * (including `.rules`), apply the size cap, and sort paths for a stable prefix.
 *
 * `cwd` is the effective ResourceLoader cwd (workspace or sandbox mount).
 * When `projectRules` was resolved from a different root (e.g. host workspace
 * while cwd is the sandbox), both roots' candidates are stripped before inject.
 */
export function applyProjectRulesAgentsFilesOverride(
  baseAgentsFiles: readonly AgentsFileEntry[],
  cwd: string,
  projectRules: ProjectRulesFile | null = resolveProjectRulesFile(cwd)
): AgentsFileEntry[] {
  const rootsToStrip = new Set<string>([resolve(cwd)]);
  if (projectRules) {
    rootsToStrip.add(resolve(dirname(projectRules.path)));
  }

  const withoutRootCandidates = baseAgentsFiles.filter((file) => {
    for (const root of rootsToStrip) {
      if (isWorkspaceRootCandidate(file.path, root)) {
        return false;
      }
    }
    return true;
  });

  const merged: AgentsFileEntry[] = projectRules
    ? [...withoutRootCandidates, { path: projectRules.path, content: projectRules.content }]
    : [...withoutRootCandidates];

  return merged
    .map((file) => ({
      path: file.path,
      content: truncateProjectRulesContent(file.content).content,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}
