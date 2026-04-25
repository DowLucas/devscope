import { describe, expect, test } from "bun:test";

import {
  _internals,
  computeEvidenceScore,
  type EvidenceScoreInput,
} from "../evidenceScore";

const NOW = new Date("2026-04-25T12:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe("computeEvidenceScore", () => {
  test("all-zero input → score ~0, breakdown components 0", () => {
    const result = computeEvidenceScore({
      sessionIds: [],
      userIds: [],
      latestEventAt: daysAgo(10_000), // ancient
      perSessionCounts: [],
      severities: [],
      now: NOW,
    });

    expect(result.score).toBeCloseTo(0, 5);
    expect(result.breakdown.breadth).toBe(0);
    expect(result.breakdown.engineerDiversity).toBe(0);
    // After ~10000 days the half-life decay is effectively 0.
    expect(result.breakdown.recency).toBeLessThan(1e-100);
    expect(result.breakdown.consistency).toBe(0);
    expect(result.breakdown.severity).toBe(0);
  });

  test("max-everything input → score ≈ 1.0", () => {
    const sessionIds = Array.from({ length: 30 }, (_, i) => `s${i}`);
    const userIds = Array.from({ length: 10 }, (_, i) => `u${i}`);
    // Constant per-session counts → consistency = 1.0.
    const perSessionCounts = sessionIds.map(() => 5);

    const result = computeEvidenceScore({
      sessionIds,
      userIds,
      latestEventAt: NOW,
      perSessionCounts,
      severities: ["critical"],
      now: NOW,
    });

    // log1p(30)/log1p(20) > 1 → clamped to 1.0; same for users (10 > 5).
    expect(result.breakdown.breadth).toBe(1);
    expect(result.breakdown.engineerDiversity).toBe(1);
    expect(result.breakdown.recency).toBe(1);
    expect(result.breakdown.consistency).toBe(1);
    expect(result.breakdown.severity).toBe(1);
    expect(result.score).toBeCloseTo(1.0, 5);
  });

  test("recency decay: 14d ago → recency component = 0.5", () => {
    const result = computeEvidenceScore({
      sessionIds: ["s1"],
      userIds: ["u1"],
      latestEventAt: daysAgo(14),
      perSessionCounts: [1],
      severities: ["info"],
      now: NOW,
    });
    expect(result.breakdown.recency).toBeCloseTo(0.5, 10);
  });

  test("recency decay: 28d ago → recency component = 0.25 (two half-lives)", () => {
    expect(_internals.recencyWeight(daysAgo(28), NOW)).toBeCloseTo(0.25, 10);
  });

  test("single-session evidence → consistency = 0.5 (special case)", () => {
    const result = computeEvidenceScore({
      sessionIds: ["x"],
      userIds: ["u"],
      latestEventAt: NOW,
      perSessionCounts: [5],
      severities: ["info"],
      now: NOW,
    });
    expect(result.breakdown.consistency).toBe(0.5);
  });

  test("hot-narrow vs broad-cold: similar score, distinguishable breakdown", () => {
    // Broad-cold: many sessions/users, but events are old.
    const broadCold: EvidenceScoreInput = {
      sessionIds: Array.from({ length: 20 }, (_, i) => `s${i}`),
      userIds: Array.from({ length: 5 }, (_, i) => `u${i}`),
      latestEventAt: daysAgo(56), // ~1/16 ≈ 0.0625 recency
      perSessionCounts: Array.from({ length: 20 }, () => 1),
      severities: ["info"],
      now: NOW,
    };

    // Hot-narrow: a single session today with a critical pattern.
    const hotNarrow: EvidenceScoreInput = {
      sessionIds: ["s0"],
      userIds: ["u0"],
      latestEventAt: NOW,
      perSessionCounts: [10],
      severities: ["critical"],
      now: NOW,
    };

    const a = computeEvidenceScore(broadCold);
    const b = computeEvidenceScore(hotNarrow);

    // Both land in the rough middle of the scale.
    expect(a.score).toBeGreaterThan(0.3);
    expect(a.score).toBeLessThan(0.7);
    expect(b.score).toBeGreaterThan(0.3);
    expect(b.score).toBeLessThan(0.7);

    // Distinguishable: broad-cold dominates breadth/diversity; hot-narrow
    // dominates recency and severity.
    expect(a.breakdown.breadth).toBeGreaterThan(b.breakdown.breadth);
    expect(a.breakdown.engineerDiversity).toBeGreaterThan(b.breakdown.engineerDiversity);
    expect(b.breakdown.recency).toBeGreaterThan(a.breakdown.recency);
    expect(b.breakdown.severity).toBeGreaterThan(a.breakdown.severity);
  });

  test("multi-severity: max wins", () => {
    expect(_internals.severityWeight(["info", "critical"])).toBe(1.0);
    expect(_internals.severityWeight(["info", "warning"])).toBe(0.6);
    expect(_internals.severityWeight(["info"])).toBe(0.3);
    expect(_internals.severityWeight(["warning", "critical", "info"])).toBe(1.0);
  });

  test("clamping: pathological input keeps score in [0, 1]", () => {
    const sessionIds = Array.from({ length: 1000 }, (_, i) => `s${i}`);
    const userIds = Array.from({ length: 500 }, (_, i) => `u${i}`);
    const result = computeEvidenceScore({
      sessionIds,
      userIds,
      latestEventAt: NOW,
      perSessionCounts: sessionIds.map(() => 42),
      severities: ["critical"],
      now: NOW,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    for (const v of Object.values(result.breakdown)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test("consistency: erratic counts score low", () => {
    // [1, 50] → mean=25.5, stddev=24.5 → ratio ~0.96 → consistency ~0.04.
    const c = _internals.consistency([1, 50]);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(0.1);
  });

  test("consistency: identical counts score 1.0", () => {
    expect(_internals.consistency([7, 7, 7, 7])).toBe(1);
  });

  test("logNormalized matches spec at boundary", () => {
    // breadth at exactly 20 sessions → 1.0
    expect(_internals.logNormalized(20, 20)).toBeCloseTo(1.0, 10);
    // diversity at exactly 5 users → 1.0
    expect(_internals.logNormalized(5, 5)).toBeCloseTo(1.0, 10);
  });

  test("latestEventAt accepts ISO string", () => {
    const result = computeEvidenceScore({
      sessionIds: ["s1"],
      userIds: ["u1"],
      latestEventAt: daysAgo(14).toISOString(),
      perSessionCounts: [1],
      severities: ["info"],
      now: NOW,
    });
    expect(result.breakdown.recency).toBeCloseTo(0.5, 10);
  });
});
