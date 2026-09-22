import type { SQL } from "bun";
import { score } from "@typesafe-ai/sdk";
import { askSystemOne, isTypeSafeAvailable, CONFIDENCE } from "../typesafe";
import type { FailureEpisode } from "../../services/workflowDimensions";

/**
 * Model-rated recovery for Workflow DNA.
 *
 * The heuristic `recovery_speed` measures seconds from a failure to the next
 * successful call of *any* tool. That rewards a quick unrelated Read as much
 * as a fix, and punishes a careful investigation for taking time. What it is
 * meant to capture is whether failures inform the next attempt — the same
 * distinction the nudge gate in `stuckness.ts` draws live, applied here in
 * retrospect over a week of episodes.
 *
 * Code answers the facts (where the failures are, which calls repeat an
 * earlier input); the model answers only the judgment. The state carries tool
 * names, success flags and input identity — never prompt text, tool input or
 * file content — so, like the nudge gate, it stays outside the privacy gate.
 *
 * Batch job, not the hook path: one request per developer, fanned out one
 * Score per episode. Returns null when unavailable, and the caller keeps the
 * heuristic dimension.
 */

const TIMEOUT_MS = 30_000;

/** Most recent episodes rated per developer per run; bounds cost and context. */
export const MAX_EPISODES = 40;

/**
 * Fewer rated episodes than this and the share is a coin flip dressed up as a
 * percentage, so the dimension is reported as unknown instead.
 */
export const MIN_RATED_EPISODES = 3;

const RECOVERY_LEVELS = [
  "Adapted. After the failure the next calls changed tool or input, and the session moved on.",
  "Partly adapted. Some calls were repeated unchanged before the approach changed.",
  "Stuck. The failing call was retried with little or no variation and failures did not inform the next attempt.",
] as const;

/** Expected score below which an episode counts as adapted. */
const ADAPTED_BELOW = 1.0;

export interface EpisodeRating {
  score: number;
  confidence: number;
}

export interface RatedEpisode {
  session_id: string;
  adapted: boolean;
}

/**
 * Pure: turn raw ratings into per-episode verdicts, dropping ones the model
 * was unsure about. An ambiguous episode is not evidence either way.
 */
export function toVerdicts(
  episodes: FailureEpisode[],
  ratings: Array<EpisodeRating | null>,
): RatedEpisode[] {
  const out: RatedEpisode[] = [];
  episodes.forEach((ep, i) => {
    const r = ratings[i];
    if (!r || r.confidence < CONFIDENCE.floor) return;
    out.push({ session_id: ep.session_id, adapted: r.score < ADAPTED_BELOW });
  });
  return out;
}

/** Pure: share of rated episodes that adapted, or null when too few to say. */
export function recoveryQualityFrom(verdicts: RatedEpisode[]): number | null {
  if (verdicts.length < MIN_RATED_EPISODES) return null;
  return verdicts.filter((v) => v.adapted).length / verdicts.length;
}

/**
 * Rate episodes with one fanned-out request. Returns one entry per episode
 * (null where the model gave no usable answer), or null if the call failed.
 */
export async function rateEpisodes(
  episodes: FailureEpisode[],
  opts: { sql?: SQL; orgId?: string } = {},
): Promise<Array<EpisodeRating | null> | null> {
  if (!isTypeSafeAvailable() || episodes.length === 0) return null;

  const state = episodes.map((ep, i) => ({
    ref: `e${i}`,
    // Index into `calls` of the failure that opened the episode.
    first_failure: ep.first_failure,
    // Oldest first. `repeat_of` points at an identical earlier call.
    calls: ep.calls,
  }));

  const questions: Record<string, ReturnType<typeof score>> = {};
  for (let i = 0; i < episodes.length; i++) {
    questions[`e${i}`] = score(
      `Judging only the tool calls in the episode with ref "e${i}", how did the session respond to its failures?`,
      RECOVERY_LEVELS,
    );
  }

  const result = await askSystemOne(state, questions, {
    timeoutMs: TIMEOUT_MS,
    feature: "workflow-recovery",
    sql: opts.sql,
    orgId: opts.orgId,
  });
  if (!result) return null;

  return episodes.map((_, i) => {
    const a = result.answers[`e${i}`];
    if (!a || a.type !== "score") return null;
    return { score: a.score, confidence: a.confidence };
  });
}
