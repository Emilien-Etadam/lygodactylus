/**
 * Deterministic assembly of the Lygodactylus-owned stable system-prompt prefix.
 *
 * Memory injection is intentionally NOT included here: it varies per turn and is
 * prepended to the user message (after this stable system prefix) so KV-cache /
 * cache_prompt / prefix-caching can reuse the system prefix across turns.
 */

export interface StableSkillPromptEntry {
  name: string;
  description: string;
  filePath: string;
  disableModelInvocation?: boolean;
}

export interface AssembleStableSystemPrefixInput {
  /** Sections from buildCoworkAppendPrompt (order preserved). */
  appendSections: string[];
  /** Skills rendered into <available_skills>; sorted by name then path. */
  skills?: StableSkillPromptEntry[];
  /** Optional project context files; sorted by path. */
  projectContextFiles?: Array<{ path: string; content: string }>;
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatSkillsBlock(skills: StableSkillPromptEntry[]): string {
  const visible = sortSkillsForStablePrefix(skills).filter(
    (skill) => !skill.disableModelInvocation
  );
  if (visible.length === 0) {
    return '';
  }
  const lines = [
    '',
    '',
    'The following skills provide specialized instructions for specific tasks.',
    "Use the read tool to load a skill's file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    '',
    '<available_skills>',
  ];
  for (const skill of visible) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push('  </skill>');
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

function formatProjectContext(
  files: Array<{ path: string; content: string }>
): string {
  if (files.length === 0) {
    return '';
  }
  const sorted = [...files].sort((left, right) => left.path.localeCompare(right.path));
  let block = '\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n';
  for (const file of sorted) {
    block += `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n\n`;
  }
  block += '</project_context>\n';
  return block;
}

/**
 * Assemble the stable prefix owned by Lygodactylus (append prompt + sorted
 * project context + sorted skills). Same inputs ⇒ byte-identical output.
 */
export function assembleStableSystemPrefix(input: AssembleStableSystemPrefixInput): string {
  const append = input.appendSections
    .filter((section) => Boolean(section && section.trim()))
    .join('\n\n');
  const project = formatProjectContext(input.projectContextFiles ?? []);
  const skills = formatSkillsBlock(input.skills ?? []);
  return `${append}${project}${skills}`;
}
