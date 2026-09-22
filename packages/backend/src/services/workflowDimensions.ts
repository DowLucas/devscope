/**
 * Pure Workflow DNA computations, split out of `jobs/workflowProfileComputation.ts`
 * so they can be tested offline and applied to any subset of sessions — the
 * whole week, or only the sessions of one intent.
 */

export interface DimensionSession {
  id: string;
  duration_min: number | string | null;
  session_intent?: string | null;
  session_intent_confidence?: number | null;
}

export interface DimensionEvent {
  event_type: string;
  session_id: string;
  payload: unknown;
  created_at: string | Date;
}

export interface Dimensions {
  iterative_vs_planning: number | null;
  tool_diversity: number | null;
  recovery_speed: number | null;
  session_depth: number | null;
  prompt_density: number | null;
  agent_usage: number | null;
  raw_metrics: {
    total_sessions: number;
    total_events: number;
    total_tool_calls: number;
    unique_tools: number;
    total_prompts: number;
    avg_duration_min: number;
    avg_recovery_seconds: number;
  };
  sessions_analyzed: number;
}

export function parsePayload(payload: unknown): Record<string, any> | null {
  if (payload == null) return null;
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload as Record<string, any>;
}

const isToolResult = (t: string) => t === "tool.complete" || t === "tool.fail";

/** The six heuristic dimensions. Formulas are unchanged from the original job. */
export function computeDimensions(
  sessions: DimensionSession[],
  events: DimensionEvent[],
): Dimensions {
  const toolEvents = events.filter((e) => isToolResult(e.event_type));
  const totalToolCalls = toolEvents.length;
  const uniqueTools = new Set(
    toolEvents.map((e) => parsePayload(e.payload)?.toolName ?? "unknown"),
  ).size;

  const prompts = events.filter((e) => e.event_type === "prompt.submit");
  const totalDurationMin = sessions.reduce(
    (sum, s) => sum + (Number(s.duration_min) || 0),
    0,
  );

  // tool_diversity: unique/total, 0-1
  const toolDiversity =
    totalToolCalls > 0
      ? Math.min(uniqueTools / Math.max(totalToolCalls * 0.1, 1), 1)
      : null;

  // session_depth: avg duration / 120 min cap
  const avgDuration = sessions.length > 0 ? totalDurationMin / sessions.length : 0;
  const sessionDepth = Math.min(avgDuration / 120, 1);

  // prompt_density: prompts per minute / 2.0 cap
  const promptsPerMin = totalDurationMin > 0 ? prompts.length / totalDurationMin : 0;
  const promptDensity = Math.min(promptsPerMin / 2.0, 1);

  // agent_usage
  const sessionsWithAgents = new Set(
    events.filter((e) => e.event_type === "agent.start").map((e) => e.session_id),
  ).size;
  const agentUsage = sessions.length > 0 ? sessionsWithAgents / sessions.length : 0;

  // iterative_vs_planning: high tool/prompt ratio = iterative
  const toolsPerPrompt = prompts.length > 0 ? totalToolCalls / prompts.length : 0;
  const iterativeVsPlanning = Math.min(toolsPerPrompt / 5, 1); // cap at 5 tools/prompt

  // recovery_speed: avg time between fail and next complete
  const recoveryTimes: number[] = [];
  for (const sessionEvents of groupBySession(events).values()) {
    for (let i = 0; i < sessionEvents.length; i++) {
      if (sessionEvents[i].event_type !== "tool.fail") continue;
      for (let j = i + 1; j < sessionEvents.length; j++) {
        if (sessionEvents[j].event_type === "tool.complete") {
          recoveryTimes.push(
            (new Date(sessionEvents[j].created_at).getTime() -
              new Date(sessionEvents[i].created_at).getTime()) /
              1000,
          );
          break;
        }
      }
    }
  }
  // No failures = perfect recovery; otherwise scale inversely with avg recovery time
  const avgRecovery =
    recoveryTimes.length > 0
      ? recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length
      : 0;
  const recoverySpeed = recoveryTimes.length === 0 ? 1 : 1 / (1 + avgRecovery / 60);

  return {
    iterative_vs_planning: iterativeVsPlanning,
    tool_diversity: toolDiversity,
    recovery_speed: recoverySpeed,
    session_depth: sessionDepth,
    prompt_density: promptDensity,
    agent_usage: agentUsage,
    raw_metrics: {
      total_sessions: sessions.length,
      total_events: events.length,
      total_tool_calls: totalToolCalls,
      unique_tools: uniqueTools,
      total_prompts: prompts.length,
      avg_duration_min: avgDuration,
      avg_recovery_seconds: avgRecovery,
    },
    sessions_analyzed: sessions.length,
  };
}

/** Events grouped by session, preserving input order (callers pass them sorted). */
export function groupBySession<E extends { session_id: string }>(events: E[]): Map<string, E[]> {
  const out = new Map<string, E[]>();
  for (const e of events) {
    const arr = out.get(e.session_id);
    if (arr) arr.push(e);
    else out.set(e.session_id, [e]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Intent breakdown
// ---------------------------------------------------------------------------

/**
 * Below this many sessions an intent slice is too thin to describe a habit, and
 * a single odd session would dominate it.
 */
export const MIN_SESSIONS_PER_INTENT = 3;

/**
 * Whether a session's intent label is trustworthy enough to slice on.
 *
 * Low-confidence labels are excluded rather than counted, per migration 041:
 * an ambiguous session is not evidence about any bucket. A null confidence is
 * a Gemini-fallback or pre-041 label, which is kept, as the rollups do.
 */
export function usableIntent(
  s: Pick<DimensionSession, "session_intent" | "session_intent_confidence">,
  floor: number,
): string | null {
  if (!s.session_intent) return null;
  const c = s.session_intent_confidence;
  if (c != null && c < floor) return null;
  return s.session_intent;
}

/** Sessions grouped by usable intent, keeping only slices with enough sessions. */
export function sessionsByIntent<S extends DimensionSession>(
  sessions: S[],
  floor: number,
): Map<string, S[]> {
  const out = new Map<string, S[]>();
  for (const s of sessions) {
    const intent = usableIntent(s, floor);
    if (!intent) continue;
    const arr = out.get(intent);
    if (arr) arr.push(s);
    else out.set(intent, [s]);
  }
  for (const [intent, arr] of out) {
    if (arr.length < MIN_SESSIONS_PER_INTENT) out.delete(intent);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Failure episodes (input to the model-rated recovery dimension)
// ---------------------------------------------------------------------------

// A type alias, not an interface: interfaces carry no index signature, so
// they are not assignable to the SDK's JSON `EntryType` state.
export type EpisodeCall = {
  tool: string;
  ok: boolean;
  /** Index of an earlier call in this episode with identical tool and input. */
  repeat_of: number | null;
};

export interface FailureEpisode {
  session_id: string;
  /** Index in `calls` of the failure that opened the episode. */
  first_failure: number;
  calls: EpisodeCall[];
}

/** Calls of lead-in shown before the first failure, for context. */
const EPISODE_LEAD_IN = 2;
/** Calls after the last failure — enough to see whether the approach changed. */
const EPISODE_FOLLOW = 6;
/** Hard cap so one pathological loop cannot blow the request's context. */
const EPISODE_MAX_CALLS = 20;

/**
 * Cut each session's tool sequence into failure episodes.
 *
 * An episode opens at a failure and extends while further failures arrive
 * within EPISODE_FOLLOW calls, so a burst of failures is judged as one
 * episode rather than several overlapping ones. It carries only tool names,
 * success flags and input identity — no prompt text, tool input or file
 * content — so rating it sends no developer content off the box.
 */
export function extractFailureEpisodes(events: DimensionEvent[]): FailureEpisode[] {
  const episodes: FailureEpisode[] = [];

  for (const [sessionId, sessionEvents] of groupBySession(events)) {
    const calls = sessionEvents
      .filter((e) => isToolResult(e.event_type))
      .map((e) => {
        const p = parsePayload(e.payload);
        return {
          tool: String(p?.toolName ?? "unknown"),
          ok: e.event_type === "tool.complete",
          // Without a hash the call's identity is unknown; treat as unique.
          hash: typeof p?.toolInputHash === "string" ? p.toolInputHash : null,
        };
      });

    let i = 0;
    while (i < calls.length) {
      if (calls[i].ok) {
        i++;
        continue;
      }
      const start = Math.max(0, i - EPISODE_LEAD_IN);
      let lastFail = i;
      let end = Math.min(calls.length, i + EPISODE_FOLLOW + 1);
      for (let j = i + 1; j < end; j++) {
        if (!calls[j].ok) {
          lastFail = j;
          end = Math.min(calls.length, j + EPISODE_FOLLOW + 1);
        }
      }
      end = Math.min(end, start + EPISODE_MAX_CALLS);

      const slice = calls.slice(start, end);
      const firstSeen = new Map<string, number>();
      episodes.push({
        session_id: sessionId,
        first_failure: i - start,
        calls: slice.map((c, k) => {
          const key = c.hash ? `${c.tool}|${c.hash}` : null;
          const prior = key ? firstSeen.get(key) : undefined;
          if (key && prior === undefined) firstSeen.set(key, k);
          return { tool: c.tool, ok: c.ok, repeat_of: prior ?? null };
        }),
      });
      i = Math.max(lastFail + 1, end);
    }
  }

  return episodes;
}
