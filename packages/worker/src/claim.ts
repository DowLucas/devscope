import type { SQL } from "bun";
import type { SuggestionCandidate } from "@devscope/shared";
import { claimNextCandidate as dbClaim } from "../../backend/src/db/suggestionQueries";

/**
 * Atomically claim the next queued candidate. Crash recovery is handled
 * server-side: `claim_expires_at` is set to NOW() + 10 minutes by the
 * underlying `UPDATE` (see `claimNextCandidate` in suggestionQueries.ts).
 *
 * The worker NEVER manually un-claims on crash — letting the lease TTL
 * expire is the recovery mechanism. A follow-up reaper job (out of scope
 * for Task 5.1) will reset stuck `in_progress` candidates back to `queued`
 * once their lease has elapsed.
 */
export async function claimNextCandidate(
  sql: SQL
): Promise<SuggestionCandidate | null> {
  return dbClaim(sql);
}
