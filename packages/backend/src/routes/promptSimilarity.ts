import { Hono } from "hono";
import type { SQL } from "bun";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { findSimilarPrompts } from "../db/promptSimilarityQueries";

// Pre-flight similar-prompts lookup for the UserPromptSubmit hook.
// Returns up to 3 prior prompts from the same developer + project that
// match the current one by keyword, each with that session's outcome.
// The plugin formats this into `additionalContext` so Claude can consider
// what worked / didn't work last time.

const similarSchema = z.object({
  session_id: z.string().min(1).max(200),
  developer_id: z.string().min(1).max(200),
  project_path: z.string().max(1000),
  prompt_text: z.string().min(1).max(8000),
});

export function promptSimilarityRoutes(sql: SQL) {
  const app = new Hono();

  app.post("/similar", zValidator("json", similarSchema), async (c) => {
    const body = c.req.valid("json");

    try {
      const matches = await findSimilarPrompts(sql, {
        developerId: body.developer_id,
        projectPath: body.project_path,
        promptText: body.prompt_text,
        excludeSessionId: body.session_id,
        limit: 3,
      });

      // Format short, attribution-free summary lines.
      const lines = matches.map((m) => {
        const outcome =
          m.tool_count === 0
            ? "(no tools used)"
            : `${Math.round(m.success_rate * 100)}% success across ${m.tool_count} tool calls`;
        const snippet = m.prompt_text.length > 140
          ? m.prompt_text.slice(0, 137) + "..."
          : m.prompt_text;
        return `- "${snippet}" — ${outcome}`;
      });

      return c.json({ matches, lines });
    } catch (err) {
      console.error("[prompt-similarity] failed:", err);
      return c.json({ matches: [], lines: [] });
    }
  });

  return app;
}
