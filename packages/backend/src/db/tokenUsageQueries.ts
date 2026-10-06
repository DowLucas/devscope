import type { SQL } from "bun";
import { inList } from "./utils";

// Token accounting v2 (migration 055). Usage is stored per (session,
// transcript, model) in session_token_usage and rolled up onto the sessions
// row, whose total_* / estimated_cost_usd columns every existing query reads.
// Costs are API-equivalent list prices (token_cost_usd), not plan charges.

/** Cumulative usage for one model in one transcript, as the plugin sums it. */
export interface ModelUsage {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  calls?: number;
}

export interface UsageSnapshot {
  /** Claude Code session id of the transcript the totals were summed from. */
  transcriptId: string;
  byModel: Record<string, ModelUsage>;
}

export type TokenSource = "exact" | "estimated" | "legacy";

/**
 * Store exact transcript totals. Values are cumulative, so each field only
 * moves up: a late or reordered event can never lower a total, and a replay
 * of the same snapshot is a no-op.
 */
export async function applyUsageSnapshot(sql: SQL, sessionId: string, snapshot: UsageSnapshot): Promise<void> {
  const models = Object.entries(snapshot.byModel);
  if (models.length === 0) return;
  await sql.begin(async (tx) => {
    for (const [model, u] of models) {
      await tx`
        INSERT INTO session_token_usage AS t (
          session_id, transcript_id, model, source,
          input_tokens, output_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_read_tokens, api_calls
        ) VALUES (
          ${sessionId}, ${snapshot.transcriptId}, ${model}, 'exact',
          ${u.input}, ${u.output}, ${u.cacheWrite5m}, ${u.cacheWrite1h}, ${u.cacheRead}, ${u.calls ?? 0}
        )
        ON CONFLICT (session_id, transcript_id, model) DO UPDATE SET
          source = 'exact',
          input_tokens = GREATEST(t.input_tokens, EXCLUDED.input_tokens),
          output_tokens = GREATEST(t.output_tokens, EXCLUDED.output_tokens),
          cache_write_5m_tokens = GREATEST(t.cache_write_5m_tokens, EXCLUDED.cache_write_5m_tokens),
          cache_write_1h_tokens = GREATEST(t.cache_write_1h_tokens, EXCLUDED.cache_write_1h_tokens),
          cache_read_tokens = GREATEST(t.cache_read_tokens, EXCLUDED.cache_read_tokens),
          api_calls = GREATEST(t.api_calls, EXCLUDED.api_calls),
          updated_at = NOW()`;
    }
    await repriceRows(tx, [sessionId]);
    await rollupSessions(tx, [sessionId]);
  });
}

async function repriceRows(sql: SQL, sessionIds: string[]): Promise<void> {
  await sql`
    UPDATE session_token_usage
    SET cost_usd = token_cost_usd(model, input_tokens, output_tokens,
                                  cache_write_5m_tokens, cache_write_1h_tokens, cache_read_tokens)
    WHERE session_id IN (${inList(sessionIds)})`;
}

/**
 * Recompute sessions.total_* / estimated_cost_usd / token_source from
 * session_token_usage. Exact rows win: once any transcript of a session has
 * exact totals, its estimate is ignored.
 */
export async function rollupSessions(sql: SQL, sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  await sql`
    UPDATE sessions s SET
      total_input_tokens = a.input_tokens,
      total_output_tokens = a.output_tokens,
      total_cache_creation_tokens = a.cache_write_tokens,
      total_cache_read_tokens = a.cache_read_tokens,
      estimated_cost_usd = a.cost_usd,
      token_source = a.source
    FROM (
      SELECT
        u.session_id,
        SUM(u.input_tokens)::BIGINT AS input_tokens,
        SUM(u.output_tokens)::BIGINT AS output_tokens,
        SUM(u.cache_write_5m_tokens + u.cache_write_1h_tokens)::BIGINT AS cache_write_tokens,
        SUM(u.cache_read_tokens)::BIGINT AS cache_read_tokens,
        SUM(u.cost_usd) AS cost_usd,
        MIN(u.source) AS source
      FROM session_token_usage u
      WHERE u.session_id IN (${inList(sessionIds)})
        AND (u.source = 'exact' OR NOT EXISTS (
          SELECT 1 FROM session_token_usage e
          WHERE e.session_id = u.session_id AND e.source = 'exact'))
      GROUP BY u.session_id
    ) a
    WHERE s.id = a.session_id`;
}

/** Whether exact (or estimated) v2 figures already own this session's totals. */
export async function getTokenSource(sql: SQL, sessionId: string): Promise<TokenSource | null> {
  const [row] = await sql`SELECT token_source FROM sessions WHERE id = ${sessionId}`;
  return ((row as { token_source?: TokenSource | null } | undefined)?.token_source ?? null);
}

export interface UsageEstimate {
  output: number;
  cacheWrite1h: number;
  cacheRead: number;
  calls: number;
}

/** One event as the estimator reads it. */
export interface EstimatorEvent {
  event_type: string;
  token_usage: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  } | null;
}

/**
 * Reconstruct a session's usage from what pre-v2 plugins recorded: each
 * response.complete carries the usage of the turn's LAST API call, i.e. the
 * context size at the end of the turn. A turn makes roughly one call per tool
 * round plus the final answer, and each call re-reads the context, which grows
 * from the previous turn's size to this one's.
 *
 * Calibrated 2026-10-06 against 24 sessions with transcripts: the summed cost
 * landed at 0.98x the real figure; single sessions ranged 0.4x-2.2x. Main
 * thread only (subagents never produced response.complete), so a lower bound
 * for subagent-heavy sessions. Returns null when no event carried usage.
 */
export function estimateUsage(events: EstimatorEvent[]): UsageEstimate | null {
  let prevContext = 0;
  let tools = 0;
  let had = false;
  const est = { output: 0, cacheWrite1h: 0, cacheRead: 0, calls: 0 };
  for (const e of events) {
    switch (e.event_type) {
      case "prompt.submit":
        tools = 0;
        break;
      case "tool.start":
        tools++;
        break;
      case "compact.complete":
        prevContext = 0;
        break;
      case "response.complete": {
        const u = e.token_usage;
        if (!u || typeof u.cacheReadTokens !== "number") break;
        const context = (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheCreationTokens ?? 0);
        const calls = tools + 1;
        est.cacheRead += prevContext > 0 ? (calls * (prevContext + context)) / 2 : calls * context;
        est.cacheWrite1h += Math.max(context - prevContext, 0) + (u.cacheCreationTokens ?? 0);
        est.output += calls * (u.outputTokens ?? 0);
        est.calls += calls;
        prevContext = context;
        tools = 0;
        had = true;
        break;
      }
    }
  }
  if (!had) return null;
  return {
    output: Math.round(est.output),
    cacheWrite1h: Math.round(est.cacheWrite1h),
    cacheRead: Math.round(est.cacheRead),
    calls: est.calls,
  };
}

async function loadEstimatorEvents(sql: SQL, sessionId: string): Promise<EstimatorEvent[]> {
  return (await sql`
    SELECT event_type, payload->'tokenUsage' AS token_usage
    FROM events
    WHERE session_id = ${sessionId}
      AND event_type IN ('prompt.submit', 'tool.start', 'compact.complete', 'response.complete')
    ORDER BY created_at, id`) as EstimatorEvent[];
}

export interface EstimateResult {
  sessionId: string;
  model: string | null;
  before: { costUsd: number; source: TokenSource | null };
  estimate: UsageEstimate | null;
  /** List-price cost of the estimate under the session's model. */
  costUsd: number;
}

/**
 * Estimate one legacy session. With `write`, stores the estimate and makes it
 * the session's figures (unless exact data arrived meanwhile).
 */
export async function estimateSession(sql: SQL, sessionId: string, write: boolean): Promise<EstimateResult | null> {
  const [s] = await sql`
    SELECT model, token_source, estimated_cost_usd FROM sessions WHERE id = ${sessionId}`;
  if (!s) return null;
  const session = s as { model: string | null; token_source: TokenSource | null; estimated_cost_usd: string | null };
  const estimate = estimateUsage(await loadEstimatorEvents(sql, sessionId));
  const model = session.model ?? "";
  let costUsd = 0;
  if (estimate) {
    const [c] = await sql`
      SELECT token_cost_usd(${model}, 0, ${estimate.output}, 0, ${estimate.cacheWrite1h}, ${estimate.cacheRead})::FLOAT8 AS cost`;
    costUsd = Number((c as { cost: number }).cost);
  }
  if (write && session.token_source !== "exact") {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM session_token_usage WHERE session_id = ${sessionId} AND source = 'estimated'`;
      if (estimate) {
        await tx`
          INSERT INTO session_token_usage (
            session_id, transcript_id, model, source,
            output_tokens, cache_write_1h_tokens, cache_read_tokens, api_calls, cost_usd
          ) VALUES (
            ${sessionId}, '', ${model}, 'estimated',
            ${estimate.output}, ${estimate.cacheWrite1h}, ${estimate.cacheRead}, ${estimate.calls}, ${costUsd}
          )`;
        await rollupSessions(tx, [sessionId]);
      } else {
        // Nothing to estimate from: the legacy figures were never real usage.
        await tx`
          UPDATE sessions SET token_source = NULL, total_input_tokens = 0, total_output_tokens = 0,
            total_cache_creation_tokens = 0, total_cache_read_tokens = 0, estimated_cost_usd = 0
          WHERE id = ${sessionId} AND token_source = 'legacy'`;
      }
    });
  }
  return {
    sessionId,
    model: session.model,
    before: { costUsd: Number(session.estimated_cost_usd ?? 0), source: session.token_source },
    estimate,
    costUsd,
  };
}

/** Legacy sessions due for estimation, oldest first. */
export async function getLegacySessions(
  sql: SQL,
  opts: { limit: number; endedAfter?: string | null; settledMinutes: number },
): Promise<string[]> {
  const endedAfter = opts.endedAfter ?? null;
  const rows = await sql`
    SELECT id FROM sessions
    WHERE token_source = 'legacy'
      AND status = 'ended'
      AND ended_at < NOW() - make_interval(mins => ${opts.settledMinutes})
      AND (${endedAfter}::TIMESTAMPTZ IS NULL OR ended_at > ${endedAfter}::TIMESTAMPTZ)
    ORDER BY ended_at
    LIMIT ${opts.limit}`;
  return (rows as { id: string }[]).map((r) => r.id);
}

export interface BackfillItem extends UsageSnapshot {
  /** DevScope session id; defaults to the transcript id, which is how sessions start. */
  sessionId?: string;
}

/**
 * Exact usage uploaded by /devscope:backfill-usage. Only sessions owned by
 * `devIds` are touched; anything else is reported as skipped.
 */
export async function backfillExactUsage(
  sql: SQL,
  devIds: string[],
  items: BackfillItem[],
): Promise<{ applied: number; skipped: number }> {
  if (devIds.length === 0 || items.length === 0) return { applied: 0, skipped: items.length };
  const ids = [...new Set(items.map((i) => i.sessionId ?? i.transcriptId))];
  const owned = new Set(
    ((await sql`
      SELECT id FROM sessions
      WHERE id IN (${inList(ids)}) AND developer_id IN (${inList(devIds)})`) as { id: string }[]).map((r) => r.id),
  );
  let applied = 0;
  for (const item of items) {
    const sessionId = item.sessionId ?? item.transcriptId;
    if (!owned.has(sessionId)) continue;
    await applyUsageSnapshot(sql, sessionId, item);
    applied++;
  }
  return { applied, skipped: items.length - applied };
}
