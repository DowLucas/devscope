import { describe, expect, test } from "bun:test";
import { mayScore } from "../detection/promptSpecificity";
import {
  canShortCircuit,
  INDIVIDUAL_REFUSAL,
  UNSUPPORTED_ANSWER,
  type QueryRoute,
} from "../workflows/queryRouting";
import { CONFIDENCE } from "../typesafe";

/**
 * Offline tests for the B-tier decision logic. The API calls themselves need a
 * live key and are covered by the smoke script.
 */

describe("B6 prompt specificity privacy gate", () => {
  test("permits the two content modes", () => {
    expect(mayScore("open")).toBe(true);
    // 'full' is the pre-6cc3667 name for 'open' and still exists in old rows.
    expect(mayScore("full")).toBe(true);
  });

  test("refuses private", () => {
    expect(mayScore("private")).toBe(false);
  });

  test("refuses standard", () => {
    // Standard is metadata-only; prompt text must not leave the box.
    expect(mayScore("standard")).toBe(false);
  });

  test("refuses legacy null, which defaults to standard", () => {
    expect(mayScore(null)).toBe(false);
    expect(mayScore(undefined)).toBe(false);
  });

  test("is a whitelist, so an unknown future mode defaults to refusing", () => {
    expect(mayScore("some-new-mode")).toBe(false);
    expect(mayScore("")).toBe(false);
  });
});

describe("B7 query routing", () => {
  const route = (over: Partial<QueryRoute> = {}): QueryRoute => ({
    block: false,
    scope: "team_analytics",
    targetsIndividual: 0.02,
    scopeConfidence: 0.95,
    ...over,
  });

  test("short-circuits an unsupported question the model is sure about", () => {
    expect(canShortCircuit(route({ scope: "unsupported", scopeConfidence: 0.95 }))).toBe(true);
  });

  test("does not short-circuit an unsupported read it is unsure about", () => {
    // A shaky "unsupported" should fall through to the normal path rather than
    // refuse a question that might well be answerable.
    expect(canShortCircuit(route({ scope: "unsupported", scopeConfidence: 0.6 }))).toBe(false);
  });

  test("never short-circuits an in-scope question", () => {
    for (const scope of ["team_analytics", "session_lookup", "tooling_help"] as const) {
      expect(canShortCircuit(route({ scope, scopeConfidence: 1 }))).toBe(false);
    }
  });

  test("short-circuit requires the high band, not merely the floor", () => {
    expect(
      canShortCircuit(route({ scope: "unsupported", scopeConfidence: CONFIDENCE.floor })),
    ).toBe(false);
    expect(
      canShortCircuit(route({ scope: "unsupported", scopeConfidence: CONFIDENCE.high })),
    ).toBe(true);
  });

  test("refusal text redirects to team framing and names no individual", () => {
    expect(INDIVIDUAL_REFUSAL).toMatch(/team/i);
    expect(INDIVIDUAL_REFUSAL.length).toBeLessThan(400);
    expect(UNSUPPORTED_ANSWER).toMatch(/session data/i);
  });
});
