import type { SQL } from "bun";
import { noul, score } from "@typesafe-ai/sdk";
import { askSystemOne, isTypeSafeAvailable, CONFIDENCE } from "../typesafe";

/**
 * Semantic individual-targeting check (TypeSafe System One).
 *
 * The roster and shape checks in `validator.ts` are lexical: they catch a name,
 * an email, or a "developer X did Y" sentence shape. They cannot catch a leak
 * that names nobody, and those are the ones that matter:
 *
 *   "the engineer who owns the auth service has the highest failure rate"
 *   "one contributor accounts for most of the retry loops this week"
 *
 * Both single out an individual. Neither contains a roster token, so both pass
 * the lexical layer untouched. This module closes that gap by asking the model
 * directly, which is exactly the kind of atomic judgment System One is for.
 *
 * Failure policy: fail open to the lexical result. A null return means the
 * check could not run, not that the text is clean — the roster and shape
 * checks have already run by then, so failing open leaves the guard exactly as
 * strong as it was before this module existed, never weaker.
 */

/**
 * Tight budget: this sits on user-facing paths (chat, report generation).
 * Retries are disabled because a slow guard that eventually answers is worse
 * than a fast fall-through to the lexical result.
 */
const TIMEOUT_MS = 3_000;

/** Response text is truncated; a leak shows up early and the state has a budget. */
const MAX_CHARS = 6_000;

/** Severity rubric. Index is the score, so order matters. */
const SEVERITY_LEVELS = [
  "Describes only teams, projects, tools, or aggregate activity. No individual is distinguishable.",
  "Refers to an individual in passing but gives no way to tell who, and makes no judgment about them.",
  "Singles out one person — by name, role, ownership, or unique description — or ranks, compares, or evaluates individuals.",
] as const;

const TARGETING_QUESTION =
  "Does this text single out one specific individual person, rather than describing the team, a project, or tooling in aggregate? Count any wording that would let a reader work out which individual is meant, including by their role, the component they own, or a unique description. Do not count a named tool, product, project, or organisation as an individual.";

export interface SemanticLeakAssessment {
  /** P(yes) the text singles out an individual. */
  targetingProbability: number;
  /** Expected severity, 0-2, against SEVERITY_LEVELS. */
  severity: number;
  /** Calibrated confidence in the severity score. */
  confidence: number;
  /** Severity is high and the model is confident enough to act on it. */
  shouldReject: boolean;
  /** Worth flagging for a human to review, short of rejecting outright. */
  shouldFlag: boolean;
}

/**
 * P(yes) at or above which targeting is treated as real. High bar: a false
 * reject replaces a legitimate answer with the fallback message, which is a
 * visible failure for the user.
 */
const TARGETING_REJECT_P = 0.8;

/** Lower bar for flagging into the ethics audit log without changing output. */
const TARGETING_FLAG_P = 0.55;

/** Expected severity at or above which the text reads as individual-level. */
const SEVERITY_REJECT = 1.5;

export async function assessIndividualTargeting(
  sql: SQL,
  text: string,
): Promise<SemanticLeakAssessment | null> {
  if (!isTypeSafeAvailable() || !text.trim()) return null;

  const result = await askSystemOne(
    { candidate_text: text.slice(0, MAX_CHARS) },
    {
      targeting: noul(TARGETING_QUESTION),
      severity: score(
        "How individual-level is this text about the people who did the work?",
        SEVERITY_LEVELS,
      ),
    },
    {
      feature: "grounding-semantic",
      sql,
      timeoutMs: TIMEOUT_MS,
      maxRetries: 0,
    },
  );

  if (!result) return null;

  const targeting = result.answers.targeting;
  const severity = result.answers.severity;
  if (targeting.type !== "noul" || severity.type !== "score") return null;

  const targetingProbability = targeting.noul;

  // Either axis is sufficient, provided the score is one the model is actually
  // confident about. They measure different things and the difference matters:
  //
  //   "One contributor is responsible for most failed builds this period."
  //
  // scores severity 2 ("ranks, compares, or evaluates individuals") with high
  // confidence, while the targeting Noul sits near 0.5 — correctly, because
  // the sentence does not reveal *which* contributor. Requiring both to fire
  // would let it through, yet it is exactly the attribution the mission rules
  // forbid: problems belong to sessions, tools, and projects, never to a
  // person, named or not. The severity rubric already encodes that policy, so
  // it stands alone.
  const confidentEnough = severity.confidence >= CONFIDENCE.floor;
  const shouldReject =
    confidentEnough &&
    (severity.score >= SEVERITY_REJECT ||
      targetingProbability >= TARGETING_REJECT_P);

  return {
    targetingProbability,
    severity: severity.score,
    confidence: severity.confidence,
    shouldReject,
    shouldFlag: !shouldReject && targetingProbability >= TARGETING_FLAG_P,
  };
}
