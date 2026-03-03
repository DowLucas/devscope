import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
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

const createPlaybookSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  tool_sequence: z.array(z.string().min(1).max(100).regex(/^[a-zA-Z0-9_\-:.]+$/)).min(1).max(50),
  when_to_use: z.string().min(1).max(2000),
  success_metrics: z.record(z.unknown()).optional(),
  source_pattern_id: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
});

const updatePlaybookSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
  when_to_use: z.string().min(1).max(2000).optional(),
  status: z.enum(["active", "draft", "archived"]).optional(),
});

export function playbooksRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/", async (c) => {
    const status = c.req.query("status") ?? "active";
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 500);
    const playbooks = await getPlaybooks(sql, { status, limit });
    return c.json(playbooks);
  });

  app.get("/:id", async (c) => {
    const playbook = await getPlaybookById(sql, c.req.param("id"));
    if (!playbook) return c.json({ error: "Not found" }, 404);

    const days = Math.min(Math.max(Number(c.req.query("days") ?? 30), 1), 365);
    const adoption = await getPlaybookAdoption(sql, playbook.id, days);

    return c.json({ ...playbook, adoption });
  });

  app.post("/", zValidator("json", createPlaybookSchema), async (c) => {
    const body = c.req.valid("json");
    const orgId = c.get("orgId" as never) as string;

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

  app.put("/:id", zValidator("json", updatePlaybookSchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const orgId = c.get("orgId" as never) as string;

    // Verify playbook exists before mutation
    const existing = await getPlaybookById(sql, id);
    if (!existing) {
      return c.json({ error: "Playbook not found" }, 404);
    }

    const playbook = await updatePlaybook(sql, id, body);
    if (!playbook) return c.json({ error: "Not found" }, 404);
    return c.json(playbook);
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const orgId = c.get("orgId" as never) as string;

    // Verify playbook exists before mutation
    const existing = await getPlaybookById(sql, id);
    if (!existing) {
      return c.json({ error: "Playbook not found" }, 404);
    }

    await archivePlaybook(sql, id);
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
