import { Hono } from "hono";
import type { SQL } from "bun";
import {
  getPlaybooks,
  getPlaybookById,
  createPlaybook,
  updatePlaybook,
  archivePlaybook,
  getPlaybookAdoption,
} from "../db/playbookQueries";
import { runPlaybookWorkflow } from "../ai/workflows/playbookWorkflow";

function clampInt(val: string | undefined, def: number, max: number): number {
  if (!val) return def;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : def;
}

export function playbooksRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/", async (c) => {
    const status = c.req.query("status") || "active";
    const limit = clampInt(c.req.query("limit"), 50, 200);
    return c.json(await getPlaybooks(sql, { status, limit }));
  });

  app.get("/:id", async (c) => {
    const playbook = await getPlaybookById(sql, c.req.param("id"));
    if (!playbook) return c.json({ error: "Playbook not found" }, 404);

    const adoption = await getPlaybookAdoption(sql, playbook.id);
    return c.json({ ...playbook, adoption });
  });

  app.post("/", async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.description || !body.tool_sequence || !body.when_to_use) {
      return c.json({ error: "Missing required fields: name, description, tool_sequence, when_to_use" }, 400);
    }
    const playbook = await createPlaybook(sql, {
      name: body.name,
      description: body.description,
      tool_sequence: body.tool_sequence,
      when_to_use: body.when_to_use,
      success_metrics: body.success_metrics,
      created_by: "manual",
    });
    return c.json(playbook, 201);
  });

  app.post("/generate", async (c) => {
    try {
      const playbooks = await runPlaybookWorkflow(sql);
      return c.json({ playbooks, count: playbooks.length });
    } catch (err) {
      console.error("[playbooks] Generation failed:", err);
      return c.json({ error: "Playbook generation failed" }, 500);
    }
  });

  app.put("/:id", async (c) => {
    const body = await c.req.json();
    const updated = await updatePlaybook(sql, c.req.param("id"), body);
    if (!updated) return c.json({ error: "Playbook not found" }, 404);
    return c.json(updated);
  });

  app.delete("/:id", async (c) => {
    await archivePlaybook(sql, c.req.param("id"));
    return c.json({ ok: true });
  });

  return app;
}
