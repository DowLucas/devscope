import { Hono } from "hono";
import type { SQL } from "bun";
import type { TeamSkill } from "@devscope/shared";
import {
  getTeamSkills,
  getTeamSkillById,
  updateTeamSkill,
  archiveTeamSkill,
  approveTeamSkill,
  getSkillPatternLinks,
  getSkillVersionHistory,
  getOrgSkillStats,
} from "../db/teamSkillQueries";
import { isAiAvailable } from "../ai/gemini";
import { runSkillGenerationWorkflow } from "../ai/workflows/skillGenerationWorkflow";
import { runSkillRefinementWorkflow } from "../ai/workflows/skillRefinementWorkflow";

function renderSkillMd(skill: TeamSkill): string {
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

export function teamSkillsRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/", async (c) => {
    const orgId = c.get("orgId" as never) as string;
    const status = c.req.query("status");
    const limit = Number(c.req.query("limit") ?? 50);
    const skills = await getTeamSkills(sql, orgId, { status, limit });
    return c.json(skills);
  });

  app.get("/stats", async (c) => {
    const orgId = c.get("orgId" as never) as string;
    const stats = await getOrgSkillStats(sql, orgId);
    return c.json(stats);
  });

  app.post("/generate", async (c) => {
    if (!isAiAvailable()) {
      return c.json({ error: "AI features unavailable" }, 503);
    }

    const orgId = c.get("orgId" as never) as string;
    try {
      const skills = await runSkillGenerationWorkflow(sql, orgId);
      return c.json(skills);
    } catch (err) {
      console.error("[team-skills] Generation failed:", err);
      return c.json({ error: "Generation failed" }, 500);
    }
  });

  app.get("/export-all", async (c) => {
    const orgId = c.get("orgId" as never) as string;
    const skills = await getTeamSkills(sql, orgId, { status: "active" });
    const files = skills.map((skill) => ({
      filename: skill.name.toLowerCase().replace(/\s+/g, '-') + '.md',
      content: renderSkillMd(skill),
    }));
    return c.json(files);
  });

  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const skill = await getTeamSkillById(sql, id);
    if (!skill) return c.json({ error: "Not found" }, 404);

    const links = await getSkillPatternLinks(sql, id);
    const versions = await getSkillVersionHistory(sql, id);

    return c.json({ ...skill, links, versions });
  });

  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const skill = await updateTeamSkill(sql, id, body);
    if (!skill) return c.json({ error: "Not found" }, 404);
    return c.json(skill);
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    await archiveTeamSkill(sql, id);
    return c.json({ ok: true });
  });

  app.post("/:id/approve", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user" as never) as any;
    const skill = await approveTeamSkill(sql, id, user.id);
    if (!skill) return c.json({ error: "Not found" }, 404);
    return c.json(skill);
  });

  app.post("/:id/refine", async (c) => {
    if (!isAiAvailable()) {
      return c.json({ error: "AI features unavailable" }, 503);
    }

    const id = c.req.param("id");
    const orgId = c.get("orgId" as never) as string;
    try {
      const result = await runSkillRefinementWorkflow(sql, id, orgId);
      return c.json(result);
    } catch (err) {
      console.error("[team-skills] Refinement failed:", err);
      return c.json({ error: "Refinement failed" }, 500);
    }
  });

  app.get("/:id/export", async (c) => {
    const id = c.req.param("id");
    const skill = await getTeamSkillById(sql, id);
    if (!skill) return c.json({ error: "Not found" }, 404);

    const md = renderSkillMd(skill);
    return c.text(md, 200, { "Content-Type": "text/markdown" });
  });

  app.get("/:id/versions", async (c) => {
    const id = c.req.param("id");
    const versions = await getSkillVersionHistory(sql, id);
    return c.json(versions);
  });

  return app;
}
