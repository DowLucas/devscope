import type { SQL } from "bun";
import { sql as Sql } from "bun";
import type { TeamSkill, TeamSkillPatternLink, TeamSkillStatus, TeamSkillStats } from "@devscope/shared";

// --- Team Skill CRUD ---

export async function createTeamSkill(
  sql: SQL,
  skill: {
    organization_id: string;
    name: string;
    description: string;
    trigger_phrases: string[];
    skill_body: string;
    source_pattern_ids?: string[];
    source_anti_pattern_ids?: string[];
    version?: number;
    previous_version_id?: string | null;
    generation_context?: Record<string, unknown>;
    status?: TeamSkillStatus;
    created_by?: string;
  }
): Promise<TeamSkill> {
  const id = crypto.randomUUID();
  const triggerArr = `{${skill.trigger_phrases.map(t => `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
  const srcPatterns = `{${(skill.source_pattern_ids ?? []).map(t => `"${t}"`).join(",")}}`;
  const srcAntiPatterns = `{${(skill.source_anti_pattern_ids ?? []).map(t => `"${t}"`).join(",")}}`;
  const genContext = JSON.stringify(skill.generation_context ?? {});

  await sql`
    INSERT INTO team_skills (
      id, organization_id, name, description, trigger_phrases, skill_body,
      source_pattern_ids, source_anti_pattern_ids, version, previous_version_id,
      generation_context, status, created_by
    )
    VALUES (
      ${id}, ${skill.organization_id}, ${skill.name}, ${skill.description},
      ${Sql.unsafe(`'${triggerArr.replace(/'/g, "''")}'`)}::TEXT[],
      ${skill.skill_body},
      ${Sql.unsafe(`'${srcPatterns.replace(/'/g, "''")}'`)}::TEXT[],
      ${Sql.unsafe(`'${srcAntiPatterns.replace(/'/g, "''")}'`)}::TEXT[],
      ${skill.version ?? 1},
      ${skill.previous_version_id ?? null},
      ${genContext}::JSONB,
      ${skill.status ?? "draft"},
      ${skill.created_by ?? "auto"}
    )`;

  const [row] = await sql`SELECT * FROM team_skills WHERE id = ${id}`;
  return row as TeamSkill;
}

export async function getTeamSkills(
  sql: SQL,
  orgId: string,
  opts?: { status?: string; limit?: number }
): Promise<TeamSkill[]> {
  const limit = opts?.limit ?? 50;

  if (opts?.status) {
    return (await sql`
      SELECT * FROM team_skills
      WHERE organization_id = ${orgId} AND status = ${opts.status}
      ORDER BY created_at DESC
      LIMIT ${limit}`) as TeamSkill[];
  }

  return (await sql`
    SELECT * FROM team_skills
    WHERE organization_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT ${limit}`) as TeamSkill[];
}

export async function getTeamSkillById(
  sql: SQL,
  id: string
): Promise<TeamSkill | null> {
  const [row] = await sql`SELECT * FROM team_skills WHERE id = ${id}`;
  return (row as TeamSkill) ?? null;
}

export async function updateTeamSkill(
  sql: SQL,
  id: string,
  updates: Partial<{
    name: string;
    description: string;
    trigger_phrases: string[];
    skill_body: string;
    status: TeamSkillStatus;
    effectiveness_score: number;
  }>
): Promise<TeamSkill | null> {
  if (updates.name !== undefined) {
    await sql`UPDATE team_skills SET name = ${updates.name}, updated_at = NOW() WHERE id = ${id}`;
  }
  if (updates.description !== undefined) {
    await sql`UPDATE team_skills SET description = ${updates.description}, updated_at = NOW() WHERE id = ${id}`;
  }
  if (updates.skill_body !== undefined) {
    await sql`UPDATE team_skills SET skill_body = ${updates.skill_body}, updated_at = NOW() WHERE id = ${id}`;
  }
  if (updates.trigger_phrases !== undefined) {
    const triggerArr = `{${updates.trigger_phrases.map(t => `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
    await sql`UPDATE team_skills SET trigger_phrases = ${Sql.unsafe(`'${triggerArr.replace(/'/g, "''")}'`)}::TEXT[], updated_at = NOW() WHERE id = ${id}`;
  }
  if (updates.status !== undefined) {
    await sql`UPDATE team_skills SET status = ${updates.status}, updated_at = NOW() WHERE id = ${id}`;
  }
  if (updates.effectiveness_score !== undefined) {
    await sql`UPDATE team_skills SET effectiveness_score = ${updates.effectiveness_score}, updated_at = NOW() WHERE id = ${id}`;
  }
  const [row] = await sql`SELECT * FROM team_skills WHERE id = ${id}`;
  return (row as TeamSkill) ?? null;
}

export async function archiveTeamSkill(sql: SQL, id: string): Promise<void> {
  await sql`UPDATE team_skills SET status = 'archived', updated_at = NOW() WHERE id = ${id}`;
}

export async function approveTeamSkill(
  sql: SQL,
  id: string,
  approvedBy: string
): Promise<TeamSkill | null> {
  await sql`
    UPDATE team_skills
    SET status = 'approved', approved_by = ${approvedBy}, approved_at = NOW(), updated_at = NOW()
    WHERE id = ${id}`;
  const [row] = await sql`SELECT * FROM team_skills WHERE id = ${id}`;
  return (row as TeamSkill) ?? null;
}

// --- Pattern Links ---

export async function linkSkillToPattern(
  sql: SQL,
  link: {
    skill_id: string;
    pattern_id?: string;
    anti_pattern_id?: string;
    link_type: "source_pattern" | "anti_pattern_solution";
  }
): Promise<TeamSkillPatternLink> {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO team_skill_pattern_links (id, skill_id, pattern_id, anti_pattern_id, link_type)
    VALUES (${id}, ${link.skill_id}, ${link.pattern_id ?? null}, ${link.anti_pattern_id ?? null}, ${link.link_type})`;
  const [row] = await sql`SELECT * FROM team_skill_pattern_links WHERE id = ${id}`;
  return row as TeamSkillPatternLink;
}

export async function getSkillPatternLinks(
  sql: SQL,
  skillId: string
): Promise<TeamSkillPatternLink[]> {
  return (await sql`
    SELECT * FROM team_skill_pattern_links
    WHERE skill_id = ${skillId}
    ORDER BY created_at ASC`) as TeamSkillPatternLink[];
}

// --- Version History ---

export async function getSkillVersionHistory(
  sql: SQL,
  skillId: string
): Promise<TeamSkill[]> {
  // Walk the previous_version_id chain using a recursive CTE
  return (await sql`
    WITH RECURSIVE chain AS (
      SELECT * FROM team_skills WHERE id = ${skillId}
      UNION ALL
      SELECT ts.* FROM team_skills ts
        JOIN chain c ON ts.id = c.previous_version_id
    )
    SELECT * FROM chain
    ORDER BY version DESC`) as TeamSkill[];
}

// --- Stats ---

export async function getOrgSkillStats(
  sql: SQL,
  orgId: string
): Promise<TeamSkillStats> {
  const [row] = await sql`
    SELECT
      COUNT(*)::INT as total,
      COUNT(*) FILTER (WHERE status = 'draft')::INT as draft,
      COUNT(*) FILTER (WHERE status = 'approved')::INT as approved,
      COUNT(*) FILTER (WHERE status = 'active')::INT as active,
      COUNT(*) FILTER (WHERE status = 'archived')::INT as archived,
      AVG(effectiveness_score)::FLOAT as avg_effectiveness
    FROM team_skills
    WHERE organization_id = ${orgId}`;

  return {
    total: (row as any)?.total ?? 0,
    draft: (row as any)?.draft ?? 0,
    approved: (row as any)?.approved ?? 0,
    active: (row as any)?.active ?? 0,
    archived: (row as any)?.archived ?? 0,
    avg_effectiveness: (row as any)?.avg_effectiveness ?? null,
  };
}

// --- Helpers ---

export async function getActiveSkillNames(
  sql: SQL,
  orgId: string
): Promise<string[]> {
  const rows = await sql`
    SELECT name FROM team_skills
    WHERE organization_id = ${orgId} AND status IN ('active', 'approved', 'draft')`;
  return rows.map((r: any) => r.name);
}
