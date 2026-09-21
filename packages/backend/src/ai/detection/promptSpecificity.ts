import type { SQL } from "bun";
import { score } from "@typesafe-ai/sdk";
import { askSystemOne, isTypeSafeAvailable, CONFIDENCE } from "../typesafe";

/**
 * Model-scored prompt specificity (B6).
 *
 * `promptFeatures.ts` derives `avg_specificity` from five regex probes: does
 * the text contain a path, a camelCase identifier, an error, a line number,
 * and is the word count in a sensible band. That approximates specificity by
 * proxy — it rewards a prompt for *looking* specific rather than for actually
 * pinning down what the developer wants. "fix the thing in auth.ts:42" scores
 * near the top; "the retry backoff should be exponential, not linear, because
 * the downstream API rate-limits on burst" scores near the bottom.
 *
 * A rubric does this directly, and composite scoring says to let the model
 * judge the dimension and keep the weighting in code.
 *
 * PRIVACY — read this before changing anything here.
 *
 * `promptFeatures.ts` documents that raw prompt text is never sent to an LLM,
 * and the query feeding it in `patternQueries.ts` has no privacy filter at all
 * (it reads promptText for every session, private included) precisely because
 * the text stayed on the box. This module breaks that assumption, so it
 * enforces its own gate and cannot rely on the caller's:
 *
 *   open / full      -> may be scored ('full' is the pre-6cc3667 name)
 *   standard / NULL  -> never sent; the local heuristic stands
 *   private          -> never sent
 *
 * Anything not explicitly open is excluded. The gate is a whitelist, not a
 * blacklist, so a new privacy mode defaults to "do not send".
 */

/** Sessions per request. */
const BATCH_SIZE = 30;
/** Enough to judge intent; the tail costs tokens without adding signal. */
const MAX_PROMPT_CHARS = 500;
/** Prompts sampled per session — first, plus a couple more for a fair average. */
const MAX_PROMPTS_PER_SESSION = 3;

/** Whitelist. Everything else is excluded. */
const CONTENT_MODES = new Set(["open", "full"]);

/**
 * Rubric levels. Index is the score, so order matters. Normalised to 0-1 on
 * the way out to stay compatible with the existing `avg_specificity` scale.
 */
const SPECIFICITY_LEVELS = [
  "Vague. Does not say what to change or what outcome is wanted — a reader would have to guess the target.",
  "Partial. Names a general area or symptom but leaves the target or the desired outcome open.",
  "Specific. Names what to change and what the result should be, enough to act without guessing.",
  "Precise. Names the target, the desired outcome, and the constraint or reason that rules out the obvious alternative.",
] as const;

const TOP_LEVEL = SPECIFICITY_LEVELS.length - 1;

export interface SpecificityInput {
  sessionId: string;
  /** Prompt texts for the session, oldest first. */
  prompts: (string | null)[];
  /** The session's recorded privacy mode. */
  privacyMode: string | null;
}

export interface SpecificityVerdict {
  /** 0-1, directly comparable with the local heuristic's `avg_specificity`. */
  specificity: number;
  confidence: number;
}

/** True when this session's prompts may be sent to a second processor. */
export function mayScore(privacyMode: string | null | undefined): boolean {
  return CONTENT_MODES.has(privacyMode ?? "");
}

/**
 * Score a batch of sessions.
 *
 * Returns null when TypeSafe is unavailable or every session is excluded, so
 * the caller keeps the local heuristic. Sessions that are gated out are simply
 * absent from the map — the caller must not treat absence as a low score.
 */
export async function scorePromptSpecificity(
  sql: SQL,
  items: SpecificityInput[],
): Promise<Map<string, SpecificityVerdict> | null> {
  if (!isTypeSafeAvailable()) return null;

  const eligible = items.filter((i) => {
    if (!mayScore(i.privacyMode)) return false;
    return i.prompts.some((p) => typeof p === "string" && p.trim().length > 0);
  });
  if (eligible.length === 0) return null;

  const out = new Map<string, SpecificityVerdict>();

  for (let start = 0; start < eligible.length; start += BATCH_SIZE) {
    const batch = eligible.slice(start, start + BATCH_SIZE);

    const state = batch.map((item, i) => ({
      ref: `p${i}`,
      prompts: item.prompts
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        .slice(0, MAX_PROMPTS_PER_SESSION)
        .map((p) => p.slice(0, MAX_PROMPT_CHARS)),
    }));

    const questions: Record<string, ReturnType<typeof score>> = {};
    for (let i = 0; i < batch.length; i++) {
      questions[`p${i}`] = score(
        `Considering only the prompts with ref "p${i}": how specific are they as instructions to a coding assistant? Judge how well they pin down what to change and what the result should be, not how technical the wording looks.`,
        SPECIFICITY_LEVELS,
      );
    }

    const result = await askSystemOne(state, questions, {
      feature: "prompt-specificity",
      sql,
      timeoutMs: 30_000,
    });
    if (!result) return out.size > 0 ? out : null;

    for (let i = 0; i < batch.length; i++) {
      const answer = result.answers[`p${i}`];
      if (!answer || answer.type !== "score") continue;
      // Low confidence means the levels were ambiguous for this text. Leave it
      // out rather than record a number the model does not stand behind — the
      // caller then keeps the local heuristic for that session.
      if (answer.confidence < CONFIDENCE.floor) continue;
      out.set(batch[i]!.sessionId, {
        specificity: Math.min(1, Math.max(0, answer.score / TOP_LEVEL)),
        confidence: answer.confidence,
      });
    }
  }

  return out.size > 0 ? out : null;
}
