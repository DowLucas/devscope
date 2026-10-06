import type { TeamSkill } from "@devscope/shared";

/** A team skill as a SKILL.md file: frontmatter, trigger phrases, body. */
export function renderSkillMd(skill: TeamSkill): string {
  const frontmatter = [
    '---',
    `name: ${skill.name.toLowerCase().replace(/\s+/g, '-')}`,
    `description: ${skill.description}`,
    '---',
  ].join('\n');

  const triggers = skill.trigger_phrases.length > 0
    ? `\n## Trigger Phrases\n\n${skill.trigger_phrases.map(t => `- "${t}"`).join('\n')}\n`
    : '';

  return `${frontmatter}\n${triggers}\n${skill.skill_body}\n`;
}
