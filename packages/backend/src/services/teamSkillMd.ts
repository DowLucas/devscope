import type { TeamSkill } from "@devscope/shared";

/**
 * Collapses text to one trimmed line of at most `max` characters, so a field
 * can't start a new frontmatter key, list item or heading. Team skills reach
 * other developers' model context through the devscope-live mod.
 */
export function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/** A skill name as a SKILL.md `name`: lowercase letters, digits and hyphens. */
export function skillSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "team-skill";
}

/** A team skill as a SKILL.md file: frontmatter, trigger phrases, body. */
export function renderSkillMd(skill: TeamSkill): string {
  const frontmatter = [
    "---",
    `name: ${skillSlug(skill.name)}`,
    // JSON string syntax is a valid YAML double-quoted scalar.
    `description: ${JSON.stringify(oneLine(skill.description, 1024))}`,
    "---",
  ].join("\n");

  const triggers = skill.trigger_phrases.length > 0
    ? `\n## Trigger Phrases\n\n${skill.trigger_phrases.map((t) => `- ${JSON.stringify(oneLine(t, 500))}`).join("\n")}\n`
    : "";

  return `${frontmatter}\n${triggers}\n${skill.skill_body}\n`;
}
