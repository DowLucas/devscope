import type { SQL } from "bun";
import { noul } from "@typesafe-ai/sdk";
import { askSystemOne, isTypeSafeAvailable } from "../typesafe";

/**
 * Success-claim classification via TypeSafe System One.
 *
 * Splits the hallucinated-success judgment along the line it should have been
 * split on all along:
 *
 *   - Did a verification step actually run?  A fact. Answered by code from the
 *     event log (`hasVerificationInWindow`), never by a model.
 *   - Does this response *claim* the work is done?  A language judgment. That
 *     is what this module asks the model.
 *
 * Two atomic Nouls per session rather than one broad question, per the
 * decompose-and-combine guidance:
 *
 *   `claim`  — does the response assert the work is complete and working?
 *   `hedged` — does it explicitly say the work is unverified?
 *
 * The second one matters because the anti-pattern's own suggestion tells
 * developers to say so explicitly when they cannot verify. A response that
 * follows that advice must not then be flagged for it. The regex detector has
 * no way to express this; two Nouls do.
 */

/** Response text is truncated to keep a batch inside the 64k context. */
const MAX_RESPONSE_CHARS = 1200;

/** Sessions per request. Questions are evaluated in parallel, so this is about context, not latency. */
export const CLAIM_BATCH_SIZE = 25;

/**
 * P(yes) at or above which the response counts as claiming success.
 * Deliberately above 0.5: a borderline read should not create an anti-pattern
 * against a session.
 */
const CLAIM_THRESHOLD = 0.7;

/**
 * P(yes) at or above which the response counts as having disclosed that it
 * could not verify. Lower bar than the claim: we would rather let a hedged
 * response through than punish someone for disclosing.
 */
const HEDGE_THRESHOLD = 0.5;

/**
 * Pure threshold logic, separated from the API call so the bands can be tested
 * without a network round-trip.
 */
export function verdictFrom(
  claimProbability: number,
  hedgeProbability: number,
): SuccessClaimVerdict {
  return {
    claimed:
      claimProbability >= CLAIM_THRESHOLD && hedgeProbability < HEDGE_THRESHOLD,
    claimProbability,
    hedgeProbability,
  };
}

export interface SuccessClaimVerdict {
  /** Response asserts completion and is not hedged. */
  claimed: boolean;
  /** Raw P(yes) that the response claims success. */
  claimProbability: number;
  /** Raw P(yes) that the response discloses it is unverified. */
  hedgeProbability: number;
}

const CLAIM_QUESTION =
  "The text is a coding assistant's closing message for a work session. Does it assert that the requested work is finished and working — for example by saying it is done, fixed, passing, or ready to ship? Answer yes only for an assertion about the work itself, not for a description of what was attempted or a statement that something failed.";

const HEDGE_QUESTION =
  "Does the text explicitly tell the reader that the work has NOT been verified — for example by saying tests were not run, that verification was not possible, or by asking the reader to check it? Answer yes only for an explicit disclosure, not for the mere absence of a claim.";

/**
 * Classify a batch of session responses.
 *
 * Returns a map keyed by session id, or null when TypeSafe is unavailable or
 * the call fails, so the caller falls back to the regex detector. Sessions the
 * model did not answer for are simply absent from the map.
 */
export async function classifySuccessClaims(
  sql: SQL,
  responses: Array<{ sessionId: string; text: string }>,
): Promise<Map<string, SuccessClaimVerdict> | null> {
  if (!isTypeSafeAvailable() || responses.length === 0) return null;

  const out = new Map<string, SuccessClaimVerdict>();

  for (let start = 0; start < responses.length; start += CLAIM_BATCH_SIZE) {
    const batch = responses.slice(start, start + CLAIM_BATCH_SIZE);

    const state = batch.map((r, i) => ({
      ref: `r${i}`,
      response: r.text.slice(0, MAX_RESPONSE_CHARS),
    }));

    const questions: Record<string, ReturnType<typeof noul>> = {};
    for (let i = 0; i < batch.length; i++) {
      questions[`claim${i}`] = noul(
        `Considering only the entry with ref "r${i}": ${CLAIM_QUESTION}`,
      );
      questions[`hedge${i}`] = noul(
        `Considering only the entry with ref "r${i}": ${HEDGE_QUESTION}`,
      );
    }

    const result = await askSystemOne(state, questions, {
      feature: "hallucinated-success",
      sql,
      timeoutMs: 30_000,
    });

    // A failed batch falls back for the whole run rather than silently
    // classifying part of it — a partial scan would look like a clean one.
    if (!result) return null;

    for (let i = 0; i < batch.length; i++) {
      const claim = result.answers[`claim${i}`];
      const hedge = result.answers[`hedge${i}`];
      if (!claim || claim.type !== "noul") continue;

      const claimProbability = claim.noul;
      const hedgeProbability =
        hedge && hedge.type === "noul" ? hedge.noul : 0;

      out.set(batch[i]!.sessionId, verdictFrom(claimProbability, hedgeProbability));
    }
  }

  return out;
}

/** Short human-readable evidence string for the persisted detection record. */
export function claimEvidence(verdict: SuccessClaimVerdict): string {
  return `asserted completion (p=${verdict.claimProbability.toFixed(2)}, undisclosed)`;
}
