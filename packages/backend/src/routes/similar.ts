import { Hono } from "hono";
import type { SQL } from "bun";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { SimilarSession, SimilarTurn } from "@devscope/shared";
import {
  searchSimilarTurns,
  searchSimilarSessions,
  isSessionInOrg,
  type SimilarTurnRow,
  type SimilarSessionRow,
} from "../db";
import {
  EMBEDDING_MODEL,
  isEmbeddingAvailable,
  embedQuery,
  embedDocuments,
  preparePromptText,
  toVectorLiteral,
} from "../ai/embeddings";
import { getAllDeveloperIdsForUser } from "../services/developerLink";
import { RECALL, formatRecall, selectMatches, wordCount } from "../services/promptRecall";

// Semantic retrieval over the org's prompt/response turns and sessions.
//
// Ethics: results are attributed to sessions and projects, never developers.
// Text from every non-private session in the org is returned, including
// teammates' — a deliberate, documented exception to stripSensitivePayload
// (see CLAUDE.md "Semantic retrieval").

const promptsQuery = z.object({
  q: z.string().trim().min(1).max(8000),
  kind: z.enum(["prompt", "response"]).default("prompt"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  exclude_session_id: z.string().min(1).max(200).optional(),
});

const preflightBody = z.object({
  prompt: z.string().trim().min(1).max(8000),
  session_id: z.string().min(1).max(200),
});

const sessionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

function mapTurn(r: SimilarTurnRow): SimilarTurn {
  return {
    turnId: String(r.turn_id),
    sessionId: r.session_id,
    promptAt: r.prompt_at,
    promptText: r.prompt_text,
    responseText: r.response_text,
    outcome: {
      toolCalls: r.tool_calls,
      toolFailures: r.tool_failures,
      toolsUsed: r.tools_used,
      durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
    },
    sessionTitle: r.session_title,
    sessionIntent: r.session_intent,
    projectName: r.project_name,
    similarity: r.similarity,
  };
}

function mapSession(r: SimilarSessionRow): SimilarSession {
  return {
    sessionId: r.session_id,
    sessionTitle: r.session_title,
    sessionIntent: r.session_intent,
    projectName: r.project_name,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    estimatedCostUsd: Number(r.estimated_cost_usd ?? 0),
    turnCount: r.turn_count,
    toolCalls: r.tool_calls,
    toolFailures: r.tool_failures,
    similarity: r.similarity,
  };
}

function orgDevIds(c: { get: (k: never) => unknown }): string[] {
  return (c.get("orgDeveloperIds" as never) as string[] | undefined) ?? [];
}

export function similarRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/prompts", zValidator("query", promptsQuery), async (c) => {
    if (!isEmbeddingAvailable()) {
      return c.json({ available: false, error: "Semantic retrieval is not configured" }, 503);
    }
    const q = c.req.valid("query");
    const vector = await embedQuery(q.q);
    if (!vector) {
      return c.json({ available: false, error: "Embedding service unavailable" }, 503);
    }
    const rows = await searchSimilarTurns(sql, {
      vector: toVectorLiteral(vector),
      model: EMBEDDING_MODEL,
      kind: q.kind,
      devIds: orgDevIds(c),
      limit: q.limit,
      excludeSessionId: q.exclude_session_id ?? null,
    });
    return c.json({ available: true, results: rows.map(mapTurn) });
  });

  // "You've asked this before" for the plugin's UserPromptSubmit hook. Only
  // the caller's own sessions, only strong matches from an earlier stretch of
  // work. The hook blocks the prompt, so this fails open to an empty result
  // on any problem rather than erroring.
  app.post("/preflight", zValidator("json", preflightBody), async (c) => {
    const empty = { matches: [], repeat_days: 0, context: null };
    try {
      if (!isEmbeddingAvailable()) return c.json(empty);
      const { prompt, session_id } = c.req.valid("json");
      if (wordCount(prompt) < RECALL.minWords) return c.json(empty);

      const user = c.get("user" as never) as { id?: string } | undefined;
      const own = user?.id ? await getAllDeveloperIdsForUser(sql, user.id) : [];
      const org = new Set(orgDevIds(c));
      const devIds = own.filter((d) => org.has(d));
      if (devIds.length === 0) return c.json(empty);

      // Document-side embedding: the same space and scale as stored prompts.
      const vectors = await embedDocuments([preparePromptText(prompt)], RECALL.embedTimeoutMs);
      if (!vectors) return c.json(empty);

      const rows = await searchSimilarTurns(sql, {
        vector: toVectorLiteral(vectors[0]!),
        model: EMBEDDING_MODEL,
        kind: "prompt",
        devIds,
        limit: RECALL.lookback,
        excludeSessionId: session_id,
        before: new Date(Date.now() - RECALL.recentHours * 3_600_000).toISOString(),
      });
      const { matches, repeatDays } = selectMatches(rows);
      return c.json({ matches, repeat_days: repeatDays, context: formatRecall(matches, repeatDays) });
    } catch (err) {
      console.warn("[similar] preflight failed:", err instanceof Error ? err.message : err);
      return c.json(empty);
    }
  });

  app.get("/sessions/:id", zValidator("query", sessionsQuery), async (c) => {
    if (!isEmbeddingAvailable()) {
      return c.json({ available: false, error: "Semantic retrieval is not configured" }, 503);
    }
    const id = c.req.param("id");
    const devIds = orgDevIds(c);
    // Same 404 for "missing" and "other org" so ids can't be probed.
    if (id.length > 200 || !(await isSessionInOrg(sql, id, devIds))) {
      return c.json({ error: "Session not found" }, 404);
    }
    const rows = await searchSimilarSessions(sql, {
      sessionId: id,
      model: EMBEDDING_MODEL,
      devIds,
      limit: c.req.valid("query").limit,
    });
    if (rows === null) {
      // Active, private, or not indexed yet.
      return c.json({ indexed: false, results: [] });
    }
    return c.json({ indexed: true, results: rows.map(mapSession) });
  });

  return app;
}
