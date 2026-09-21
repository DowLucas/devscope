import type { SQL } from "bun";
import {
  detectHallucinatedSuccess,
  hasVerificationInWindow,
  buildHallucinatedSuccessDetection,
} from "../detection/hallucinatedSuccess";
import { classifySuccessClaims, claimEvidence } from "../detection/successClaim";
import { upsertAntiPattern, createAntiPatternMatch } from "../../db/antiPatternQueries";
import { inList } from "../../db/utils";
import type { ToolEvent } from "../../db/patternQueries";

// Async batch detector: scans recently ended sessions for "claimed success
// without verification" and persists matches as anti_patterns. Wired from
// patternAnalysis.ts. Surfaces in dashboard + /devscope:review.
//
// Two-stage: code decides whether a verification step ran (a fact from the
// event log), then TypeSafe decides whether the response claimed success (a
// language judgment). Falls back to the local regex detector whenever TypeSafe
// is unavailable. Private-mode sessions are excluded before either stage.

export async function runHallucinatedSuccessDetection(
  sql: SQL,
  days: number = 1,
): Promise<number> {
  // Recent sessions to scan
  const sessions = await sql`
    SELECT id, privacy_mode FROM sessions
    WHERE status = 'ended'
      AND ended_at >= NOW() - make_interval(days => ${days})`;
  const sessionIds = (sessions as any[])
    .filter((s) => s.privacy_mode !== "private")
    .map((s) => s.id as string);
  if (sessionIds.length === 0) return 0;

  // Latest response.complete with text per session.
  const responseRows = await sql`
    SELECT DISTINCT ON (session_id)
      session_id,
      payload->>'responseText' as response_text
    FROM events
    WHERE session_id IN (${inList(sessionIds)})
      AND event_type = 'response.complete'
      AND payload->>'responseText' IS NOT NULL
    ORDER BY session_id, created_at DESC`;
  const responseBySession = new Map<string, string>();
  for (const r of responseRows as any[]) {
    responseBySession.set(r.session_id, r.response_text);
  }
  if (responseBySession.size === 0) return 0;

  const targetIds = [...responseBySession.keys()];

  // Tool sequences (with subcommand) for the target sessions, ordered.
  const toolRows = await sql`
    SELECT
      session_id,
      payload->>'toolName' as tool_name,
      event_type,
      payload->>'toolSubcommand' as tool_subcommand,
      created_at
    FROM events
    WHERE session_id IN (${inList(targetIds)})
      AND event_type IN ('tool.complete','tool.fail')
      AND payload->>'toolName' IS NOT NULL
    ORDER BY session_id, created_at ASC`;

  const toolsBySession = new Map<string, { tools: ToolEvent[]; subs: (string | null)[] }>();
  for (const r of toolRows as any[]) {
    let entry = toolsBySession.get(r.session_id);
    if (!entry) {
      entry = { tools: [], subs: [] };
      toolsBySession.set(r.session_id, entry);
    }
    entry.tools.push({
      tool_name: r.tool_name,
      event_type: r.event_type,
      success: r.event_type === "tool.complete",
      created_at: r.created_at,
    });
    entry.subs.push(r.tool_subcommand ?? null);
  }

  // Code answers the factual half first: which sessions ended without a
  // verification step. Only those can possibly be flagged, so only those are
  // worth asking a model about — it keeps the request small and means a
  // verified session never has its response text sent anywhere.
  const unverified: Array<{ sessionId: string; text: string }> = [];
  const trailingBySession = new Map<string, ToolEvent[]>();
  for (const sid of targetIds) {
    const t = toolsBySession.get(sid) ?? { tools: [], subs: [] };
    const { verified, trailing } = hasVerificationInWindow({
      toolSequence: t.tools,
      bashSubcommandsTrailing: t.subs.slice(-8),
    });
    trailingBySession.set(sid, trailing);
    if (verified) continue;
    const text = responseBySession.get(sid);
    if (text) unverified.push({ sessionId: sid, text });
  }

  // Model answers the language half. Null means unavailable or failed, and the
  // run falls back to the regex detector for every session.
  const verdicts = await classifySuccessClaims(sql, unverified);

  let detected = 0;
  for (const sid of targetIds) {
    const responseText = responseBySession.get(sid);
    const t = toolsBySession.get(sid) ?? { tools: [], subs: [] };
    const trailingSubs = t.subs.slice(-8);

    let hit;
    if (verdicts) {
      const verdict = verdicts.get(sid);
      if (!verdict?.claimed) continue;
      hit = buildHallucinatedSuccessDetection(
        claimEvidence(verdict),
        trailingBySession.get(sid) ?? [],
      );
    } else {
      hit = detectHallucinatedSuccess({
        toolSequence: t.tools,
        bashSubcommandsTrailing: trailingSubs,
        responseText,
      });
    }
    if (!hit) continue;

    try {
      const ap = await upsertAntiPattern(sql, {
        name: hit.name,
        description: hit.description,
        detection_rule: hit.rule,
        severity: hit.severity,
        suggestion: hit.suggestion,
        data_context: hit.details,
      });
      await createAntiPatternMatch(sql, sid, ap.id, hit.details);
      detected++;
    } catch (err) {
      console.error("[hallucinated-success] persist failed:", (err as Error).message);
    }
  }

  return detected;
}
