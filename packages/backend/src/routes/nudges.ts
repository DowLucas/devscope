import { Hono } from "hono";
import type { SQL } from "bun";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { identicalFailCount } from "../services/sessionStuckState";

// Fast-path endpoint for the PreToolUse hook. Answers "should this tool call
// be hard-blocked because the same call has already failed N times?" using
// only in-memory state — no DB hit, no LLM. Targeted latency: <50ms.

const checkSchema = z.object({
  session_id: z.string().min(1).max(200),
  tool_name: z.string().min(1).max(200),
  tool_input_hash: z.string().min(1).max(200),
});

const HARD_BLOCK_AT = 2; // After 2 identical failures, block the 3rd attempt.

export function nudgesRoutes(_sql: SQL) {
  const app = new Hono();

  app.post("/check", zValidator("json", checkSchema), async (c) => {
    const { session_id, tool_name, tool_input_hash } = c.req.valid("json");

    const fails = identicalFailCount(session_id, tool_name, tool_input_hash);
    if (fails >= HARD_BLOCK_AT) {
      return c.json({
        block: true,
        reason: `DevScope: this exact ${tool_name} call has already failed ${fails} time${fails === 1 ? "" : "s"} in this session. Try a different approach — change the input, gather more context (Read the failing file/error message), or break the task into a smaller step before retrying.`,
        signals: { tool_name, identical_failures: fails },
      });
    }

    return c.json({ block: false });
  });

  return app;
}
