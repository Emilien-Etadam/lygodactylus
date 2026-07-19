/**
 * Deterministic ordering helpers for the KV-cacheable system-prompt prefix.
 *
 * Memory injection is intentionally NOT part of the system prefix: it varies
 * per turn and is prepended to the user message so cache_prompt / prefix
 * caching can reuse the system prefix across turns.
 */

export interface StableSkillPromptEntry {
  name: string;
  description: string;
  filePath: string;
  disableModelInvocation?: boolean;
}

/**
 * Sort skills for a byte-stable <available_skills> block.
 * Generic so pi Skill objects keep their full shape through skillsOverride.
 */
export function sortSkillsForStablePrefix<T extends StableSkillPromptEntry>(skills: T[]): T[] {
  return [...skills].sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName;
    }
    return left.filePath.localeCompare(right.filePath);
  });
}
