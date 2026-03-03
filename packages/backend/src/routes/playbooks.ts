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
import { isAiAvailable } from "../ai/gemini";
import { runPlaybookWorkflow } from "../ai/workflows/playbookWorkflow";

export function playbooksRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/", async (c) => {
    const status = c.req.query("status") ?? "active";
    const limit = Number(c.req.query("limit") ?? 50);
    const playbooks = await getPlaybooks(sql, { status, limit });
    return c.json(playbooks);
  });

  app.get("/:id", async (c) => {
    const playbook = await getPlaybookById(sql, c.req.param("id"));
    if (!playbook) return c.json({ error: "Not found" }, 404);

    const days = Number(c.req.query("days") ?? 30);
    const adoption = await getPlaybookAdoption(sql, playbook.id, days);

    return c.json({ ...playbook, adoption });
  });

  app.post("/", async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.description || !Array.isArray(body.tool_sequence) || body.tool_sequence.length === 0 || !body.when_to_use) {
      return c.json({ error: "name, description, tool_sequence (non-empty array), and when_to_use are required" }, 400);
    }

    const playbook = await createPlaybook(sql, {
      name: body.name,
      description: body.description,
      tool_sequence: body.tool_sequence,
      when_to_use: body.when_to_use,
      success_metrics: body.success_metrics,
      source_pattern_id: body.source_pattern_id,
      created_by: "manual",
    });
    return c.json(playbook, 201);
  });

  app.put("/:id", async (c) => {
    const body = await c.req.json();
    const playbook = await updatePlaybook(sql, c.req.param("id"), body);
    if (!playbook) return c.json({ error: "Not found" }, 404);
    return c.json(playbook);
  });

  app.delete("/:id", async (c) => {
    await archivePlaybook(sql, c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/generate", async (c) => {
    if (!isAiAvailable()) {
      return c.json({ error: "AI features unavailable" }, 503);
    }

    try {
      const playbooks = await runPlaybookWorkflow(sql);
      return c.json(playbooks);
    } catch (err) {
      console.error("[playbooks] Generation failed:", err);
      return c.json({ error: "Generation failed" }, 500);
    }
  });

  return app;
}
