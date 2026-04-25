import type { SQL } from "bun";
import type { SuggestionCandidate, SuggestionCandidateStatus } from "@devscope/shared";
import { getSuppression } from "../../backend/src/db/suppressionQueries";

/**
 * Result of revalidating a freshly-claimed candidate. If `ok` is false, the
 * caller should mark the candidate with `markStatus` and skip the sandbox.
 */
export type RevalidateResult =
  | { ok: true }
  | { ok: false; markStatus: Extract<SuggestionCandidateStatus, "stale" | "dismissed">; reason: string };

/** Trailing window the revalidator considers "fresh" evidence. */
const EVIDENCE_FRESHNESS_HOURS = 72;

/**
 * Re-check that the world hasn't changed since this candidate was enqueued:
 *
 *   1. Anti-pattern occurrences cited in `evidenceRefs.antiPatternIds` must
 *      still have at least one match in the trailing 72 hours. If they all
 *      dropped to zero, the issue self-resolved → mark `stale`.
 *
 *   2. No suppression entry for this `suppressionKey` may have been added
 *      after the candidate's `createdAt`. If one was, the team has rejected
 *      this kind of suggestion since enqueue → mark `dismissed`.
 *
 * Both checks are cheap point-lookups; they exist so the worker doesn't
 * spin up a sandbox container for evidence that's no longer real.
 */
export async function revalidate(
  sql: SQL,
  candidate: SuggestionCandidate
): Promise<RevalidateResult> {
  // ---- 2. Suppression added since enqueue? -------------------------------
  // (Cheaper of the two — short-circuit on it first.)
  const suppression = await getSuppression(sql, candidate.suppressionKey);
  if (suppression) {
    const enqueuedAt = new Date(candidate.createdAt).getTime();
    const lastRejectedAt = new Date(suppression.lastRejectedAt).getTime();
    if (lastRejectedAt > enqueuedAt) {
      return {
        ok: false,
        markStatus: "dismissed",
        reason: "suppression entry created after candidate was enqueued",
      };
    }
  }

  // ---- 1. Evidence still fresh? ------------------------------------------
  const antiPatternIds = candidate.evidenceRefs.antiPatternIds ?? [];
  if (antiPatternIds.length > 0) {
    const rows = (await sql`
      SELECT COUNT(*)::INT AS recent_matches
      FROM session_anti_pattern_matches
      WHERE anti_pattern_id = ANY(${antiPatternIds}::uuid[])
        AND created_at >= NOW() - make_interval(hours => ${EVIDENCE_FRESHNESS_HOURS})
    `) as Array<{ recent_matches: number }>;
    const recent = rows[0]?.recent_matches ?? 0;
    if (recent === 0) {
      return {
        ok: false,
        markStatus: "stale",
        reason: `no anti-pattern matches in last ${EVIDENCE_FRESHNESS_HOURS}h`,
      };
    }
  }

  return { ok: true };
}
