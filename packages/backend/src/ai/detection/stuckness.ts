import { score } from "@typesafe-ai/sdk";
import { askSystemOne, isTypeSafeAvailable, CONFIDENCE } from "../typesafe";

/**
 * Stuckness gate for the proactive nudge layer.
 *
 * The friction rules in `frictionDetector.ts` fire on counters: N consecutive
 * failures, N distinct tools failing in a window. Counters cannot tell apart
 * the two situations that produce the same count:
 *
 *   - three failures while the agent narrows down a cause, changing approach
 *     each time. Productive. A nudge here is noise.
 *   - three failures re-running the same call unchanged. Genuinely stuck. A
 *     nudge here is the whole point of the feature.
 *
 * This asks for a rubric score over the recent tool sequence and only lets the
 * nudge through when the session reads as actually stuck.
 *
 * LIVE HOOK PATH. Two rules follow from that:
 *
 *   1. Tight budget, no retries. The event ingest response must not wait on a
 *      slow model, and TypeSafe's rate limits are documented as volatile.
 *   2. Fail OPEN. If the gate cannot run, the nudge is emitted exactly as it is
 *      today. An unavailable gate must never silently disable the feature.
 *
 * The state carries tool names and success flags only — never prompt text,
 * tool input, or file content — so this path stays outside the privacy gate.
 */

/** Hard ceiling. Sits in series with nudgeWorkflow's own 800ms phrasing budget. */
const TIMEOUT_MS = 600;

const STUCKNESS_LEVELS = [
  "Making progress. Failures are incidental and the approach keeps changing in response to them.",
  "Some repetition, but the approach is still varying and recovery looks plausible.",
  "Stuck. The same approach is being retried with little or no variation, and failures are not informing the next attempt.",
] as const;

/** Expected score at or above which a nudge is worth sending. */
const NUDGE_SCORE = 1.5;

/**
 * Probability mass on the "stuck" level at or above which a nudge goes out,
 * even when the expected score is lower.
 *
 * Also the fail-open path. A model with no read at all spreads mass evenly
 * across the three levels, putting ~0.33 on the top one, which clears this bar
 * and sends the nudge. Genuine ambiguity therefore still nudges, without
 * needing a separate confidence rule.
 */
const STUCK_LEVEL_P = 0.3;

/**
 * Pure gate decision, separated from the API call so it is testable offline.
 *
 * Reads the probability on the top rubric level rather than raw confidence.
 * The two come apart in the case that matters: a session scoring 0.80 at
 * confidence 0.47 is a model unsure whether the session is level 0 or level 1
 * — both of which mean "not stuck". Raw confidence cannot tell that apart from
 * being unsure whether the session is stuck at all, so it would suppress and
 * nudge in exactly the wrong places. The distribution can.
 */
export function shouldNudgeFrom(
  scoreValue: number,
  stuckLevelProbability: number,
): boolean {
  return scoreValue >= NUDGE_SCORE || stuckLevelProbability >= STUCK_LEVEL_P;
}

export interface StucknessInput {
  ruleType: string;
  toolName: string;
  failureCount: number;
  /** Recent calls from `recentToolSummary` — no developer content. */
  recentTools: Array<{ tool: string; ok: boolean; repeat_of: number | null }>;
}

export interface StucknessVerdict {
  score: number;
  confidence: number;
  shouldNudge: boolean;
}

/**
 * Returns null when the gate could not run, which the caller must treat as
 * "send the nudge" to preserve today's behaviour.
 */
export async function assessStuckness(
  input: StucknessInput,
): Promise<StucknessVerdict | null> {
  if (!isTypeSafeAvailable() || input.recentTools.length === 0) return null;

  const result = await askSystemOne(
    {
      tripped_rule: input.ruleType,
      tool: input.toolName,
      consecutive_failures: input.failureCount,
      // Oldest first. `repeat_of` points at the index of an identical earlier
      // call, so repetition is visible without exposing any input.
      recent_calls: input.recentTools,
    },
    {
      stuckness: score(
        "An automated rule flagged possible friction in this coding session. Judging only from the recent tool calls, how stuck is it really?",
        STUCKNESS_LEVELS,
      ),
    },
    { timeoutMs: TIMEOUT_MS, maxRetries: 0 },
  );

  if (!result) return null;

  const answer = result.answers.stuckness;
  if (answer.type !== "score") return null;

  return {
    score: answer.score,
    confidence: answer.confidence,
    // Low confidence means the levels were ambiguous. Send the nudge rather
    // than suppress it: a redundant nudge is cheaper than a missed one.
    shouldNudge: shouldNudgeFrom(answer.score, answer.probabilities[2] ?? 0),
  };
}
