import { Hono } from "hono";
import { z } from "zod";
import type { SQL } from "bun";
import { renderSkillMd } from "../services/teamSkillMd";
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

const updateSkillSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000),
    trigger_phrases: z.array(z.string().min(1).max(500)).max(50),
    skill_body: z.string().max(50_000),
    status: z.enum(["draft", "approved", "active", "archived"]),
    effectiveness_score: z.number().min(0).max(1),
  })
  .partial()
  .strict();

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
    const orgId = c.get("orgId" as never) as string;
    const skill = await getTeamSkillById(sql, id, orgId);
    if (!skill) return c.json({ error: "Not found" }, 404);

    const links = await getSkillPatternLinks(sql, id, orgId);
    const versions = await getSkillVersionHistory(sql, id, orgId);

    return c.json({ ...skill, links, versions });
  });

  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    const orgId = c.get("orgId" as never) as string;
    const parsed = updateSkillSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
    }
    const skill = await updateTeamSkill(sql, id, orgId, parsed.data);
    if (!skill) return c.json({ error: "Not found" }, 404);
    return c.json(skill);
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const orgId = c.get("orgId" as never) as string;
    const archived = await archiveTeamSkill(sql, id, orgId);
    if (!archived) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  });

  app.post("/:id/approve", async (c) => {
    const id = c.req.param("id");
    const orgId = c.get("orgId" as never) as string;
    const user = c.get("user" as never) as any;
    const skill = await approveTeamSkill(sql, id, orgId, user.id);
    if (!skill) return c.json({ error: "Not found" }, 404);
    return c.json(skill);
  });

  app.post("/:id/refine", async (c) => {
    if (!isAiAvailable()) {
      return c.json({ error: "AI features unavailable" }, 503);
    }

    const id = c.req.param("id");
    const orgId = c.get("orgId" as never) as string;

    // Ownership check before the workflow touches (archives/copies) anything
    const owned = await getTeamSkillById(sql, id, orgId);
    if (!owned) return c.json({ error: "Not found" }, 404);

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
    const orgId = c.get("orgId" as never) as string;
    const skill = await getTeamSkillById(sql, id, orgId);
    if (!skill) return c.json({ error: "Not found" }, 404);

    const md = renderSkillMd(skill);
    return c.text(md, 200, { "Content-Type": "text/markdown" });
  });

  app.get("/:id/versions", async (c) => {
    const id = c.req.param("id");
    const orgId = c.get("orgId" as never) as string;
    const versions = await getSkillVersionHistory(sql, id, orgId);
    if (versions.length === 0) return c.json({ error: "Not found" }, 404);
    return c.json(versions);
  });

  return app;
}
