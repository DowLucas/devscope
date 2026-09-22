import { describe, expect, test } from "bun:test";
import {
  computeDimensions,
  extractFailureEpisodes,
  sessionsByIntent,
  usableIntent,
  MIN_SESSIONS_PER_INTENT,
  type DimensionEvent,
} from "../workflowDimensions";
import {
  recoveryQualityFrom,
  toVerdicts,
  MIN_RATED_EPISODES,
} from "../../ai/detection/recoveryQuality";
import { teamIntentAverages } from "../../db/workflowProfileQueries";
import { CONFIDENCE } from "../../ai/typesafe";
import type { WorkflowIntentProfile } from "@devscope/shared";

let t = Date.parse("2026-09-20T10:00:00Z");
function call(session: string, ok: boolean, tool = "Bash", hash: string | null = null): DimensionEvent {
  t += 1000;
  return {
    event_type: ok ? "tool.complete" : "tool.fail",
    session_id: session,
    payload: { toolName: tool, ...(hash ? { toolInputHash: hash } : {}) },
    created_at: new Date(t).toISOString(),
  };
}

describe("extractFailureEpisodes", () => {
  test("no failures, no episodes", () => {
    expect(extractFailureEpisodes([call("s", true), call("s", true)])).toEqual([]);
  });

  test("marks identical retries with repeat_of and never carries tool input", () => {
    const events = [
      call("s", true, "Read", "r1"),
      call("s", false, "Bash", "b1"),
      call("s", false, "Bash", "b1"),
      call("s", true, "Edit", "e1"),
    ];
    const [ep] = extractFailureEpisodes(events);
    expect(ep.first_failure).toBe(1);
    expect(ep.calls).toEqual([
      { tool: "Read", ok: true, repeat_of: null },
      { tool: "Bash", ok: false, repeat_of: null },
      { tool: "Bash", ok: false, repeat_of: 1 },
      { tool: "Edit", ok: true, repeat_of: null },
    ]);
    // Only these three keys may leave the box.
    for (const c of ep.calls) expect(Object.keys(c).sort()).toEqual(["ok", "repeat_of", "tool"]);
  });

  test("a burst of nearby failures is one episode; distant ones are separate", () => {
    const events = [call("s", false, "Bash", "a"), call("s", true), call("s", false, "Bash", "b")];
    for (let i = 0; i < 10; i++) events.push(call("s", true, "Read", `x${i}`));
    events.push(call("s", false, "Grep", "c"));
    const eps = extractFailureEpisodes(events);
    expect(eps).toHaveLength(2);
    expect(eps[0].calls.filter((c) => !c.ok)).toHaveLength(2);
  });

  test("missing input hash is treated as a distinct call, not a repeat", () => {
    const [ep] = extractFailureEpisodes([call("s", false, "Bash"), call("s", false, "Bash")]);
    expect(ep.calls.map((c) => c.repeat_of)).toEqual([null, null]);
  });

  test("episodes never span sessions", () => {
    const eps = extractFailureEpisodes([call("a", false), call("b", false)]);
    expect(eps.map((e) => e.session_id)).toEqual(["a", "b"]);
  });
});

describe("intent slicing", () => {
  const s = (id: string, intent: string | null, confidence: number | null) => ({
    id,
    duration_min: 10,
    session_intent: intent,
    session_intent_confidence: confidence,
  });

  test("drops low-confidence labels, keeps unscored (fallback) ones", () => {
    expect(usableIntent(s("1", "debug", 0.2), CONFIDENCE.floor)).toBeNull();
    expect(usableIntent(s("1", "debug", 0.9), CONFIDENCE.floor)).toBe("debug");
    expect(usableIntent(s("1", "debug", null), CONFIDENCE.floor)).toBe("debug");
    expect(usableIntent(s("1", null, 0.9), CONFIDENCE.floor)).toBeNull();
  });

  test("omits intents with too few sessions", () => {
    const sessions = [
      ...Array.from({ length: MIN_SESSIONS_PER_INTENT }, (_, i) => s(`b${i}`, "build", 0.9)),
      s("d1", "debug", 0.9),
    ];
    const slices = sessionsByIntent(sessions, CONFIDENCE.floor);
    expect([...slices.keys()]).toEqual(["build"]);
  });

  test("computeDimensions on a slice only counts that slice", () => {
    const d = computeDimensions([s("a", "build", 1)], [call("a", true), call("a", false)]);
    expect(d.sessions_analyzed).toBe(1);
    expect(d.raw_metrics.total_tool_calls).toBe(2);
  });
});

describe("recovery quality", () => {
  const eps = Array.from({ length: 4 }, (_, i) => ({
    session_id: `s${i}`,
    first_failure: 0,
    calls: [],
  }));

  test("drops unsure ratings and failed answers", () => {
    const v = toVerdicts(eps, [
      { score: 0.2, confidence: 0.9 },
      { score: 1.8, confidence: 0.9 },
      { score: 0.1, confidence: 0.3 }, // unsure: dropped
      null,
    ]);
    expect(v).toEqual([
      { session_id: "s0", adapted: true },
      { session_id: "s1", adapted: false },
    ]);
  });

  test("is unknown below the minimum, a share above it", () => {
    const few = Array.from({ length: MIN_RATED_EPISODES - 1 }, () => ({ session_id: "s", adapted: true }));
    expect(recoveryQualityFrom(few)).toBeNull();
    expect(
      recoveryQualityFrom([
        { session_id: "s", adapted: true },
        { session_id: "s", adapted: true },
        { session_id: "s", adapted: false },
        { session_id: "s", adapted: true },
      ]),
    ).toBe(0.75);
  });
});

describe("teamIntentAverages", () => {
  const p = (v: number, rq: number | null = null): WorkflowIntentProfile => ({
    iterative_vs_planning: v,
    tool_diversity: v,
    recovery_speed: v,
    recovery_quality: rq,
    session_depth: v,
    prompt_density: v,
    agent_usage: v,
    sessions_analyzed: 5,
  });

  test("withholds an intent with fewer than three developers", () => {
    const out = teamIntentAverages([{ debug: p(0.2) }, { debug: p(0.4) }]);
    expect(out.debug).toBeUndefined();
  });

  test("averages an intent with three developers", () => {
    const out = teamIntentAverages([{ build: p(0.1) }, { build: p(0.2) }, { build: p(0.6) }]);
    expect(out.build.developer_count).toBe(3);
    expect(out.build.dimension_averages.session_depth).toBeCloseTo(0.3);
  });

  test("withholds a dimension that fewer than three developers have", () => {
    const out = teamIntentAverages([{ build: p(0.1, 0.5) }, { build: p(0.2) }, { build: p(0.6) }]);
    expect(out.build.dimension_averages.recovery_quality).toBeUndefined();
  });
});
