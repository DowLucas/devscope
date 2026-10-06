import { Hono, type Context } from "hono";
import type { SQL } from "bun";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { LiveTeamSkill, NextPromptSuggestion } from "@devscope/shared";
import { searchSimilarTurns } from "../db";
import { getTeamSkills } from "../db/teamSkillQueries";
import {
  resolveOwnedSession,
  insertTurnLabel,
  insertVcsLink,
  getOpenPrRefs,
  updatePrStatus,
  getNextTurnIds,
  getOpeningTurnIds,
  getTurnSuggestionRows,
  type OwnedSession,
} from "../db/liveQueries";
import {
  EMBEDDING_MODEL,
  isEmbeddingAvailable,
  embedDocuments,
  preparePromptText,
  toVectorLiteral,
} from "../ai/embeddings";
import { getOwnOrgDevIds, getSearchableDevIdsFor } from "../services/visibility";
import { takePendingNudge } from "../services/sessionStuckState";
import { oneLine, renderSkillMd } from "../services/teamSkillMd";
import { NEXT_PROMPTS, RECENCY_STEP, rankSuggestions } from "../services/nextPrompts";

// In-session endpoints for the devscope-live mod (Claude Code function hooks).
//
// `session_id` is Claude Code's current session id; it must resolve to a
// DevScope session the caller owns, else 404 (the same answer for missing and
// not owned, so ids can't be probed). Labels, VCS links and suggestions refuse
// private sessions the same way; the nudge does not, as it carries no content.
// Reads fail open to an empty answer: the mod runs on the live hook path.
//
// Ethics: suggestions come from the caller's own and opted-in teammates'
// sessions and carry project and outcome only, never a developer identity.
// Labels and VCS links are about the caller's own sessions only.

const sessionId = z.string().min(1).max(200);

const nudgeQuery = z.object({ session_id: sessionId });

const nextPromptsBody = z.object({
  session_id: sessionId,
  after: z.string().trim().min(1).max(4000).optional(),
  project: z.string().trim().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(5).default(3),
});

const labelBody = z.object({
  session_id: sessionId,
  turn_started_at: z.string().datetime({ offset: true }),
  label: z.enum(["up", "partial", "down"]),
  source: z.enum(["explicit", "implicit"]),
});

const COMMIT_SHA = /^[0-9a-f]{7,64}$/i;
const vcsBody = z
  .object({
    session_id: sessionId,
    kind: z.enum(["commit", "pr"]),
    ref: z.string().trim().min(1).max(500),
    repo_remote: z.string().trim().min(1).max(500).optional(),
  })
  .refine((b) => (b.kind === "commit" ? COMMIT_SHA.test(b.ref) : URL.canParse(b.ref) && /^https?:/.test(b.ref)), {
    message: "ref must be a commit sha, or a PR URL",
    path: ["ref"],
  });

const openPrsQuery = z.object({ repo_remote: z.string().trim().min(1).max(500) });

const statusBody = z.object({
  ref: z.string().trim().min(1).max(500),
  state: z.enum(["open", "merged", "closed"]),
  merged_at: z.string().datetime({ offset: true }).nullish(),
  closed_at: z.string().datetime({ offset: true }).nullish(),
});

/** Open PR links handed out per request for the mod to check with `gh`. */
const OPEN_PRS_LIMIT = 20;

const SESSION_NOT_FOUND = { error: "Session not found" } as const;

function toLiveSkill(skill: Awaited<ReturnType<typeof getTeamSkills>>[number]): LiveTeamSkill {
  return {
    id: skill.id,
    name: oneLine(skill.name, 100),
    description: oneLine(skill.description, 1024),
    triggerPhrases: skill.trigger_phrases.map((t) => oneLine(t, 500)),
    content: renderSkillMd(skill),
  };
}

export function liveRoutes(sql: SQL) {
  const app = new Hono();

  async function ownedSession(c: Context, id: string, allowPrivate: boolean): Promise<OwnedSession | null> {
    const session = await resolveOwnedSession(sql, id, await getOwnOrgDevIds(sql, c));
    if (!session || (!allowPrivate && session.privacy_mode === "private")) return null;
    return session;
  }

  app.get("/team-skills", async (c) => {
    try {
      const orgId = c.get("orgId" as never) as string | undefined;
      if (!orgId) return c.json({ skills: [] });
      const skills = await getTeamSkills(sql, orgId, { status: "active", limit: 100 });
      return c.json({ skills: skills.map(toLiveSkill) });
    } catch (err) {
      console.warn("[live] team skills failed:", err instanceof Error ? err.message : err);
      return c.json({ skills: [] });
    }
  });

  app.get("/nudge", zValidator("query", nudgeQuery), async (c) => {
    try {
      const session = await ownedSession(c, c.req.valid("query").session_id, true);
      if (!session) return c.json(SESSION_NOT_FOUND, 404);
      return c.json({ nudge: takePendingNudge(session.id) });
    } catch (err) {
      console.warn("[live] nudge failed:", err instanceof Error ? err.message : err);
      return c.json({ nudge: null });
    }
  });

  app.post("/next-prompts", zValidator("json", nextPromptsBody), async (c) => {
    const empty: { suggestions: NextPromptSuggestion[] } = { suggestions: [] };
    try {
      const body = c.req.valid("json");
      const session = await ownedSession(c, body.session_id, false);
      if (!session) return c.json(SESSION_NOT_FOUND, 404);
      if (!isEmbeddingAvailable()) return c.json(empty);
      const devIds = await getSearchableDevIdsFor(sql, c);
      if (devIds.length === 0) return c.json(empty);

      if (body.after !== undefined) {
        const vectors = await embedDocuments([preparePromptText(body.after)], NEXT_PROMPTS.embedTimeoutMs);
        if (!vectors) return c.json(empty);
        const similar = (
          await searchSimilarTurns(sql, {
            vector: toVectorLiteral(vectors[0]!),
            model: EMBEDDING_MODEL,
            kind: "prompt",
            devIds,
            limit: NEXT_PROMPTS.lookback,
            excludeSessionId: session.id,
          })
        ).filter((r) => r.similarity >= NEXT_PROMPTS.minSimilarity);
        const similarity = new Map(similar.map((r) => [String(r.turn_id), r.similarity]));
        const pairs = await getNextTurnIds(sql, [...similarity.keys()]);
        const rows = await getTurnSuggestionRows(
          sql,
          pairs.map((p) => p.turn_id),
          devIds,
          NEXT_PROMPTS.maxChars,
        );
        const byTurn = new Map(rows.map((r) => [r.turn_id, r]));
        const candidates = pairs.flatMap((p) => {
          const row = byTurn.get(p.turn_id);
          const base = similarity.get(p.source_turn_id);
          return row && base !== undefined ? [{ row, base }] : [];
        });
        return c.json({ suggestions: rankSuggestions(candidates, { limit: body.limit, exclude: body.after }) });
      }

      if (body.project === undefined) return c.json(empty);
      const turnIds = await getOpeningTurnIds(sql, {
        devIds,
        project: body.project,
        excludeSessionId: session.id,
        sessionLimit: NEXT_PROMPTS.openingSessions,
      });
      const rows = (await getTurnSuggestionRows(sql, turnIds, devIds, NEXT_PROMPTS.maxChars)).sort(
        (a, b) => Date.parse(b.prompt_at) - Date.parse(a.prompt_at),
      );
      const candidates = rows.map((row, i) => ({ row, base: -i * RECENCY_STEP }));
      return c.json({ suggestions: rankSuggestions(candidates, { limit: body.limit }) });
    } catch (err) {
      console.warn("[live] next prompts failed:", err instanceof Error ? err.message : err);
      return c.json(empty);
    }
  });

  app.post("/labels", zValidator("json", labelBody), async (c) => {
    try {
      const body = c.req.valid("json");
      const session = await ownedSession(c, body.session_id, false);
      if (!session) return c.json(SESSION_NOT_FOUND, 404);
      await insertTurnLabel(sql, {
        sessionId: session.id,
        turnStartedAt: body.turn_started_at,
        label: body.label,
        source: body.source,
      });
      return c.json({ ok: true });
    } catch (err) {
      console.warn("[live] label failed:", err instanceof Error ? err.message : err);
      return c.json({ ok: false }, 500);
    }
  });

  app.post("/vcs", zValidator("json", vcsBody), async (c) => {
    try {
      const body = c.req.valid("json");
      const session = await ownedSession(c, body.session_id, false);
      if (!session) return c.json(SESSION_NOT_FOUND, 404);
      await insertVcsLink(sql, {
        sessionId: session.id,
        kind: body.kind,
        ref: body.ref,
        repoRemote: body.repo_remote ?? null,
      });
      return c.json({ ok: true });
    } catch (err) {
      console.warn("[live] vcs link failed:", err instanceof Error ? err.message : err);
      return c.json({ ok: false }, 500);
    }
  });

  app.get("/vcs/open-prs", zValidator("query", openPrsQuery), async (c) => {
    try {
      const devIds = await getOwnOrgDevIds(sql, c);
      const refs = await getOpenPrRefs(sql, devIds, c.req.valid("query").repo_remote, OPEN_PRS_LIMIT);
      return c.json({ prs: refs.map((ref) => ({ ref })) });
    } catch (err) {
      console.warn("[live] open PRs failed:", err instanceof Error ? err.message : err);
      return c.json({ prs: [] });
    }
  });

  app.post("/vcs/status", zValidator("json", statusBody), async (c) => {
    try {
      const body = c.req.valid("json");
      await updatePrStatus(sql, await getOwnOrgDevIds(sql, c), {
        ref: body.ref,
        state: body.state,
        mergedAt: body.merged_at ?? null,
        closedAt: body.closed_at ?? null,
      });
      return c.json({ ok: true });
    } catch (err) {
      console.warn("[live] PR status failed:", err instanceof Error ? err.message : err);
      return c.json({ ok: false }, 500);
    }
  });

  return app;
}
