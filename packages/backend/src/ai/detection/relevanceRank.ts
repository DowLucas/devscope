import type { SQL } from "bun";
import { score } from "@typesafe-ai/sdk";
import { askSystemOne, isTypeSafeAvailable, CONFIDENCE } from "../typesafe";

/**
 * Relevance reranking for generated advice (B8).
 *
 * Gemini is asked for "1 to 3 recommendations, quality over quantity", and
 * whatever comes back is cut with `.slice(0, 3)`. That keeps whichever items
 * the model happened to emit first, which has nothing to do with which are
 * worth a developer's attention — generators tend to lead with the safe,
 * generic observation and bury the specific one.
 *
 * Scoring each candidate and keeping the best is the rerank pattern: cheap
 * relative to the generation that produced them, and it only ever reorders and
 * trims, never invents.
 *
 * Fails open to the original order, so an unavailable reranker leaves
 * behaviour exactly as it is today.
 *
 * Nothing here sends developer identity: callers pass the generated text only,
 * which is already team-safe by the time it reaches this module.
 */

const TIMEOUT_MS = 15_000;
const MAX_ITEM_CHARS = 700;
/** Beyond this the questions stop fitting comfortably alongside the state. */
const MAX_CANDIDATES = 24;

/**
 * Rubric levels. Index is the score, so order matters. Written to reward
 * specificity and actionability, which is what separates advice worth reading
 * from advice that merely sounds reasonable.
 */
const USEFULNESS_LEVELS = [
  "Generic. Could be said to any developer on any week without looking at their data.",
  "Relevant but soft. Describes something real in the data but does not suggest anything to do differently.",
  "Useful. Points at a specific pattern in this data and implies a concrete change.",
  "Directly actionable. Names a specific pattern and a specific next step the reader could take this week.",
] as const;

const TOP_LEVEL = USEFULNESS_LEVELS.length - 1;

export interface RankedItem<T> {
  item: T;
  /** 0-1, normalised from the rubric. */
  usefulness: number;
  confidence: number;
}

/**
 * Rank candidates by usefulness and return the best `keep`.
 *
 * Returns null when reranking could not run, so the caller falls back to its
 * existing ordering. Items the model did not score keep their original
 * position relative to each other, below everything it did score.
 */
export async function rankByUsefulness<T>(
  sql: SQL,
  candidates: T[],
  toText: (item: T) => string,
  opts: { keep: number; feature: string; context?: string; orgId?: string | null },
): Promise<RankedItem<T>[] | null> {
  if (!isTypeSafeAvailable()) return null;
  if (candidates.length === 0) return null;
  // Nothing to reorder — skip the call entirely rather than spend on a no-op.
  if (candidates.length <= 1) return null;

  const pool = candidates.slice(0, MAX_CANDIDATES);

  const state = {
    ...(opts.context ? { context: opts.context.slice(0, 2_000) } : {}),
    candidates: pool.map((c, i) => ({
      ref: `c${i}`,
      text: toText(c).slice(0, MAX_ITEM_CHARS),
    })),
  };

  const questions: Record<string, ReturnType<typeof score>> = {};
  for (let i = 0; i < pool.length; i++) {
    questions[`c${i}`] = score(
      `Considering only the candidate with ref "c${i}": how useful is this piece of advice to the developer it was written for?`,
      USEFULNESS_LEVELS,
    );
  }

  const result = await askSystemOne(state, questions, {
    feature: opts.feature,
    sql,
    orgId: opts.orgId ?? undefined,
    timeoutMs: TIMEOUT_MS,
  });
  if (!result) return null;

  const scored: RankedItem<T>[] = [];
  const unscored: T[] = [];

  for (let i = 0; i < pool.length; i++) {
    const answer = result.answers[`c${i}`];
    if (!answer || answer.type !== "score" || answer.confidence < CONFIDENCE.floor) {
      unscored.push(pool[i]!);
      continue;
    }
    scored.push({
      item: pool[i]!,
      usefulness: Math.min(1, Math.max(0, answer.score / TOP_LEVEL)),
      confidence: answer.confidence,
    });
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.usefulness - a.usefulness);

  // Top-up from the unscored tail only if the model scored fewer than `keep`,
  // so an item the model could not judge never displaces one it ranked.
  const out = scored.slice(0, opts.keep);
  for (const item of unscored) {
    if (out.length >= opts.keep) break;
    out.push({ item, usefulness: 0, confidence: 0 });
  }

  return out;
}
