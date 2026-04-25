/**
 * Evidence score formula for suggestion candidates.
 *
 * Combines five 0..1 components into a single 0..1 score per the spec's
 * Data Model section:
 *
 *   evidence_score =
 *       0.30 * breadth              (log1p-normalized session count, cap 20)
 *     + 0.25 * engineerDiversity    (log1p-normalized user count, cap 5)
 *     + 0.25 * recency              (exponential half-life 14 days)
 *     + 0.10 * consistency          (1 - clamp(stddev/mean, 0, 1))
 *     + 0.10 * severity             (max of critical=1.0 / warning=0.6 / info=0.3)
 *
 * Pure: no DB, no I/O. `now` is injectable for deterministic tests.
 */

import type { EvidenceBreakdown } from "@devscope/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = "critical" | "warning" | "info";

export interface EvidenceScoreInput {
  /** De-duped session IDs the candidate cites. */
  sessionIds: string[];
  /** De-duped user IDs across those sessions. */
  userIds: string[];
  /** Timestamp of the most recent supporting event. */
  latestEventAt: Date | string;
  /** Per-session occurrence counts (length should equal `sessionIds.length`). */
  perSessionCounts: number[];
  /** Severity tags from any anti-patterns this evidence covers. */
  severities: Severity[];
  /** Injectable clock for tests. Defaults to `new Date()`. */
  now?: Date;
}

export interface EvidenceScoreResult {
  score: number;
  breakdown: EvidenceBreakdown;
}

// ---------------------------------------------------------------------------
// Component weights (must sum to 1.0)
// ---------------------------------------------------------------------------

const W_BREADTH = 0.3;
const W_DIVERSITY = 0.25;
const W_RECENCY = 0.25;
const W_CONSISTENCY = 0.1;
const W_SEVERITY = 0.1;

const BREADTH_CAP = 20;
const DIVERSITY_CAP = 5;
const RECENCY_HALF_LIFE_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 1.0,
  warning: 0.6,
  info: 0.3,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  if (!Number.isFinite(x) || x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function logNormalized(count: number, cap: number): number {
  if (count <= 0) return 0;
  return clamp01(Math.log1p(count) / Math.log1p(cap));
}

function recencyWeight(latest: Date | string, now: Date): number {
  const latestMs = latest instanceof Date ? latest.getTime() : new Date(latest).getTime();
  if (!Number.isFinite(latestMs)) return 0;
  const days = Math.max(0, (now.getTime() - latestMs) / MS_PER_DAY);
  return clamp01(Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS));
}

function consistency(perSessionCounts: number[]): number {
  if (perSessionCounts.length === 0) return 0;
  // Single-session evidence is neither stable nor erratic — neutral 0.5.
  if (perSessionCounts.length === 1) return 0.5;
  const n = perSessionCounts.length;
  const mean = perSessionCounts.reduce((a, b) => a + b, 0) / n;
  if (mean <= 0) return 0;
  const variance =
    perSessionCounts.reduce((sum, x) => sum + (x - mean) * (x - mean), 0) / n;
  const stddev = Math.sqrt(variance);
  return clamp01(1 - clamp01(stddev / mean));
}

function severityWeight(severities: Severity[]): number {
  if (severities.length === 0) return 0;
  let max = 0;
  for (const s of severities) {
    const w = SEVERITY_WEIGHT[s] ?? 0;
    if (w > max) max = w;
  }
  return max;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function computeEvidenceScore(input: EvidenceScoreInput): EvidenceScoreResult {
  const now = input.now ?? new Date();

  const breakdown: EvidenceBreakdown = {
    breadth: logNormalized(input.sessionIds.length, BREADTH_CAP),
    engineerDiversity: logNormalized(input.userIds.length, DIVERSITY_CAP),
    recency: recencyWeight(input.latestEventAt, now),
    consistency: consistency(input.perSessionCounts),
    severity: severityWeight(input.severities),
  };

  const score = clamp01(
    W_BREADTH * breakdown.breadth +
      W_DIVERSITY * breakdown.engineerDiversity +
      W_RECENCY * breakdown.recency +
      W_CONSISTENCY * breakdown.consistency +
      W_SEVERITY * breakdown.severity
  );

  return { score, breakdown };
}

// ---------------------------------------------------------------------------
// Test-only exports — internal helpers for unit testing in isolation.
// ---------------------------------------------------------------------------

export const _internals = {
  clamp01,
  logNormalized,
  recencyWeight,
  consistency,
  severityWeight,
};
