import { describe, expect, test, afterEach } from "bun:test";
import { bandFor, noulDecisiveness, CONFIDENCE } from "../typesafe";
import { verdictFrom, claimEvidence } from "../detection/successClaim";
import { shouldNudgeFrom } from "../detection/stuckness";
import { assertScreenable, isScreeningAvailable } from "../grounding/injectionScreen";
import {
  recentToolSummary,
  recordToolResult,
  __resetAllStuckState,
} from "../../services/sessionStuckState";

/**
 * Offline tests for the decision logic introduced with TypeSafe System One.
 *
 * Everything here is pure: the thresholds, the band boundaries, the privacy
 * tripwire and the state summarisation. The API calls themselves are not
 * exercised — those need a live key and are covered by the smoke script.
 */

describe("confidence bands", () => {
  test("maps confidence onto the three documented ranges", () => {
    expect(bandFor(0.95)).toBe("high");
    expect(bandFor(CONFIDENCE.high)).toBe("high");
    expect(bandFor(0.7)).toBe("medium");
    expect(bandFor(CONFIDENCE.medium)).toBe("medium");
    expect(bandFor(0.59)).toBe("low");
    expect(bandFor(0)).toBe("low");
  });
});

describe("noulDecisiveness", () => {
  test("0.5 is maximally uncertain", () => {
    expect(noulDecisiveness(0.5)).toBe(0);
  });

  test("both extremes are maximally decisive", () => {
    expect(noulDecisiveness(1)).toBe(1);
    expect(noulDecisiveness(0)).toBe(1);
  });

  test("is symmetric about 0.5", () => {
    expect(noulDecisiveness(0.8)).toBeCloseTo(noulDecisiveness(0.2), 10);
  });

  test("clamps out-of-range input", () => {
    expect(noulDecisiveness(1.4)).toBe(1);
    expect(noulDecisiveness(-0.4)).toBe(1);
  });
});

describe("success claim verdict", () => {
  test("a confident, undisclosed claim is flagged", () => {
    expect(verdictFrom(0.92, 0.05).claimed).toBe(true);
  });

  test("a borderline claim is not flagged", () => {
    expect(verdictFrom(0.65, 0.0).claimed).toBe(false);
  });

  test("disclosing that work is unverified suppresses the flag", () => {
    // This is the case the regex detector cannot express: the response says
    // "done" but also says it could not run the tests. The anti-pattern's own
    // suggestion asks for exactly that disclosure, so flagging it would punish
    // the behaviour the feature is trying to encourage.
    expect(verdictFrom(0.95, 0.9).claimed).toBe(false);
  });

  test("evidence string carries the probability, not the response text", () => {
    const evidence = claimEvidence(verdictFrom(0.91, 0.02));
    expect(evidence).toContain("0.91");
    expect(evidence).toContain("undisclosed");
  });
});

describe("stuckness gate", () => {
  // Second argument is P(top rubric level), not raw confidence.
  test("a high score lets the nudge through", () => {
    expect(shouldNudgeFrom(2.0, 0.99)).toBe(true);
  });

  test("a low score with little mass on 'stuck' suppresses the nudge", () => {
    // Failures while the approach keeps changing: productive, not stuck.
    expect(shouldNudgeFrom(0.4, 0.02)).toBe(false);
  });

  test("uncertainty spread across the two low levels still suppresses", () => {
    // The live smoke test produced exactly this: score 0.80 at confidence
    // 0.47, with the mass sitting on levels 0 and 1. Both mean "not stuck",
    // so raw confidence would have nudged here for the wrong reason.
    expect(shouldNudgeFrom(0.8, 0.05)).toBe(false);
  });

  test("a flat distribution fails open and nudges", () => {
    // No read at all puts ~1/3 on each level. Genuine ambiguity must not
    // silently disable the feature.
    expect(shouldNudgeFrom(1.0, 1 / 3)).toBe(true);
  });

  test("meaningful mass on 'stuck' nudges even when the mean is low", () => {
    // Bimodal: probably fine, but with a real chance of being stuck.
    expect(shouldNudgeFrom(1.0, 0.35)).toBe(true);
  });
});

describe("injection screening privacy tripwire", () => {
  test("allows standard and open mode content", () => {
    expect(() => assertScreenable(["standard", "open", null, undefined])).not.toThrow();
  });

  test("throws rather than send private-mode content to a second processor", () => {
    expect(() => assertScreenable(["standard", "private"])).toThrow(/private/i);
  });

  test("screening is unavailable without an API key", () => {
    // The whole suite runs without TYPESAFE_API_KEY, so this also documents
    // that every surface degrades rather than failing.
    expect(isScreeningAvailable()).toBe(false);
  });
});

describe("recentToolSummary", () => {
  afterEach(() => __resetAllStuckState());

  test("is empty for an unknown session", () => {
    expect(recentToolSummary("nope")).toEqual([]);
  });

  test("marks an identical repeat with the index of its first occurrence", () => {
    recordToolResult("s1", "Bash", "hash-a", false);
    recordToolResult("s1", "Read", "hash-b", true);
    recordToolResult("s1", "Bash", "hash-a", false);

    const summary = recentToolSummary("s1");
    expect(summary).toEqual([
      { tool: "Bash", ok: false, repeat_of: null },
      { tool: "Read", ok: true, repeat_of: null },
      { tool: "Bash", ok: false, repeat_of: 0 },
    ]);
  });

  test("a different input on the same tool is not a repeat", () => {
    recordToolResult("s2", "Bash", "hash-a", false);
    recordToolResult("s2", "Bash", "hash-b", false);

    expect(recentToolSummary("s2").map((e) => e.repeat_of)).toEqual([null, null]);
  });

  test("carries no prompt text, tool input, or file content", () => {
    recordToolResult("s3", "Bash", "secret-input-hash", false);
    const keys = Object.keys(recentToolSummary("s3")[0]!);
    expect(keys.sort()).toEqual(["ok", "repeat_of", "tool"]);
  });

  test("respects the limit, keeping the most recent calls", () => {
    for (let i = 0; i < 20; i++) recordToolResult("s4", `Tool${i}`, `h${i}`, true);
    const summary = recentToolSummary("s4", 5);
    expect(summary).toHaveLength(5);
    expect(summary[4]!.tool).toBe("Tool19");
  });
});
