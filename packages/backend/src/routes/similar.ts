import { Hono } from "hono";
import type { SQL } from "bun";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { SearchHit, SearchMatch, SearchResponse, SimilarSession, SimilarTurn } from "@devscope/shared";
import {
  searchSimilarTurns,
  searchSimilarSessions,
  isSessionInOrg,
  searchSimilarErrors,
  getSkillChains,
  keywordSearchTurns,
  vectorSearchTurns,
  fetchSearchHits,
  getSearchableProjects,
  type SimilarTurnRow,
  type SimilarSessionRow,
  type SearchHitRow,
} from "../db";
import { rrfMerge } from "../services/sessionSearch";
import {
  EMBEDDING_MODEL,
  isEmbeddingAvailable,
  embedQuery,
  embedDocuments,
  preparePromptText,
  prepareErrorText,
  toVectorLiteral,
} from "../ai/embeddings";
import { getSearchableDevIds, getViewerDevIds } from "../services/visibility";
import { RECALL, formatRecall, selectMatches, wordCount } from "../services/promptRecall";
import { ERROR_RECALL, formatErrorRecall, selectErrorMatches } from "../services/errorRecall";

// Semantic retrieval over the org's prompt/response turns and sessions.
//
// Ethics: results are attributed to sessions and projects, never developers.
// Searches the caller's own sessions plus those of teammates who opted in to
// sharing (developers.share_details); private sessions are never indexed
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

const errorBody = z.object({
  tool: z.string().trim().min(1).max(200),
  error: z.string().trim().min(1).max(20_000),
  session_id: z.string().min(1).max(200),
});

/** "After skill A you usually run B": thresholds for a learned chain. */
const SKILL_CHAINS = { minCount: 3, minShare: 0.25, perSkill: 2 } as const;

/**
 * Hybrid search tuning. Each ranking contributes this many candidates to the
 * fusion. KNN always returns neighbours, so semantic hits are cut twice: an
 * absolute floor and a window below the best hit. Measured on the homelab
 * corpus with qwen3-embedding:0.6b (2026-10-06): nonsense queries top out at
 * 0.55-0.64, real topics at 0.68-0.82.
 */
export const SEARCH = { candidates: 60, minSimilarity: 0.6, relativeWindow: 0.12 } as const;

const searchQuery = z.object({
  q: z.string().trim().min(1).max(500),
  mode: z.enum(["hybrid", "keyword", "semantic"]).default("hybrid"),
  field: z.enum(["prompt", "response", "both"]).default("both"),
  project: z.string().trim().min(1).max(500).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  all_origins: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
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

function mapHit(r: SearchHitRow, matchedBy: SearchMatch[], score: number): SearchHit {
  return {
    turnId: r.turn_id,
    sessionId: r.session_id,
    promptEventId: r.prompt_event_id,
    promptAt: r.prompt_at,
    promptSnippet: r.prompt_snippet,
    responseSnippet: r.response_snippet,
    outcome: {
      toolCalls: r.tool_calls,
      toolFailures: r.tool_failures,
      toolsUsed: r.tools_used,
      durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
    },
    sessionTitle: r.session_title,
    projectName: r.project_name,
    matchedBy,
    score,
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

  // Hook endpoints only look at the caller's own history, never teammates'.
  async function ownDevIds(c: { get: (k: never) => unknown }): Promise<string[]> {
    const own = await getViewerDevIds(sql, c);
    const org = new Set(orgDevIds(c));
    return own.filter((d) => org.has(d));
  }

  // Dashboard search: own sessions plus teammates who opted in to sharing.
  async function searchableDevIds(c: { get: (k: never) => unknown }): Promise<string[]> {
    return getSearchableDevIds(sql, orgDevIds(c), await getViewerDevIds(sql, c));
  }

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
      devIds: await searchableDevIds(c),
      limit: q.limit,
      excludeSessionId: q.exclude_session_id ?? null,
    });
    return c.json({ available: true, results: rows.map(mapTurn) });
  });

  // Session search for the dashboard and /devscope:search: a keyword ranking
  // (exact terms, identifiers, error strings) fused with semantic rankings
  // over prompts and responses. Degrades to keyword-only when embeddings are
  // unavailable instead of failing.
  // Project names for the search filter, scoped exactly like /search.
  app.get("/search/projects", async (c) => {
    return c.json({ projects: await getSearchableProjects(sql, await searchableDevIds(c)) });
  });

  app.get("/search", zValidator("query", searchQuery), async (c) => {
    const q = c.req.valid("query");
    const devIds = await searchableDevIds(c);
    const filters = { project: q.project, from: q.from, to: q.to, allOrigins: q.all_origins };

    const wantSemantic = q.mode !== "keyword";
    const vector = wantSemantic && isEmbeddingAvailable() ? await embedQuery(q.q) : null;
    // Keyword mode never embeds, so report the service's configured state.
    const semanticAvailable = wantSemantic ? vector !== null : isEmbeddingAvailable();
    const runKeyword = q.mode !== "semantic" || vector === null;

    const kinds = q.field === "both" ? (["prompt", "response"] as const) : ([q.field] as const);
    const [keyword, ...semantic] = await Promise.all([
      runKeyword
        ? keywordSearchTurns(sql, { query: q.q, field: q.field, devIds, filters, limit: SEARCH.candidates })
        : Promise.resolve([]),
      ...(vector
        ? kinds.map((kind) =>
            vectorSearchTurns(sql, {
              vector: toVectorLiteral(vector),
              model: EMBEDDING_MODEL,
              kind,
              devIds,
              filters,
              limit: SEARCH.candidates,
              minSimilarity: SEARCH.minSimilarity,
              relativeWindow: SEARCH.relativeWindow,
            }),
          )
        : []),
    ]);

    const fused = rrfMerge<SearchMatch>([
      { source: "keyword", ids: keyword.map((r) => r.turn_id) },
      ...semantic.map((list) => ({ source: "semantic" as const, ids: list.map((r) => r.turn_id) })),
    ]).slice(0, q.limit);

    const rows = await fetchSearchHits(sql, { turnIds: fused.map((h) => h.id), query: q.q, devIds });
    const byId = new Map(rows.map((r) => [r.turn_id, r]));
    const results = fused.flatMap((h) => {
      const row = byId.get(h.id);
      return row ? [mapHit(row, h.sources, h.score)] : [];
    });

    const body: SearchResponse = {
      mode: wantSemantic && vector === null ? "keyword" : q.mode,
      semanticAvailable,
      results,
    };
    return c.json(body);
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

      const devIds = await ownDevIds(c);
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

  // "This error came up before" for the plugin's PostToolUseFailure hook.
  // Fails open like /preflight.
  app.post("/error", zValidator("json", errorBody), async (c) => {
    const empty = { matches: [], context: null };
    try {
      if (!isEmbeddingAvailable()) return c.json(empty);
      const { tool, error, session_id } = c.req.valid("json");
      const devIds = await ownDevIds(c);
      if (devIds.length === 0) return c.json(empty);

      const vectors = await embedDocuments([prepareErrorText(tool, error)], ERROR_RECALL.embedTimeoutMs);
      if (!vectors) return c.json(empty);

      const rows = await searchSimilarErrors(sql, {
        vector: toVectorLiteral(vectors[0]!),
        model: EMBEDDING_MODEL,
        devIds,
        limit: ERROR_RECALL.lookback,
        excludeSessionId: session_id,
      });
      const matches = selectErrorMatches(rows);
      return c.json({ matches, context: formatErrorRecall(matches) });
    } catch (err) {
      console.warn("[similar] error recall failed:", err instanceof Error ? err.message : err);
      return c.json(empty);
    }
  });

  // The caller's learned skill sequences; the plugin caches these at session
  // start and hints the usual next skill after a Skill tool call.
  app.get("/skill-chains", async (c) => {
    const devIds = await ownDevIds(c);
    return c.json({ chains: await getSkillChains(sql, devIds, SKILL_CHAINS) });
  });

  app.get("/sessions/:id", zValidator("query", sessionsQuery), async (c) => {
    if (!isEmbeddingAvailable()) {
      return c.json({ available: false, error: "Semantic retrieval is not configured" }, 503);
    }
    const id = c.req.param("id");
    const devIds = await searchableDevIds(c);
    // Same 404 for "missing", "other org" and "not shared with you" so ids
    // can't be probed.
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
