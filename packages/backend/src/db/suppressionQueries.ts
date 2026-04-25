import type { SQL } from "bun";
import type { SuggestionKind, SuppressionEntry } from "@devscope/shared";

// ---------------------------------------------------------------------------
// Row shape (snake_case) — what Postgres returns. Private to this module.
// ---------------------------------------------------------------------------

interface SuppressionRow {
  suppression_key: string;
  repo_installation_id: string;
  kind: SuggestionKind;
  last_rejected_at: string | Date;
  rejection_reason: string | null;
  rejection_count: number;
  next_eligible_at: string | Date;
}

function rowToSuppression(row: SuppressionRow): SuppressionEntry {
  return {
    suppressionKey: row.suppression_key,
    repoInstallationId: row.repo_installation_id,
    kind: row.kind,
    lastRejectedAt: row.last_rejected_at,
    rejectionReason: row.rejection_reason,
    rejectionCount: row.rejection_count,
    nextEligibleAt: row.next_eligible_at,
  };
}

export interface SuppressionUpsertInput {
  suppressionKey: string;
  repoInstallationId: string;
  kind: SuggestionKind;
  /** ISO timestamp at which the suggestion may be reconsidered. */
  nextEligibleAt: string;
  rejectionReason?: string;
}

export async function getSuppression(
  sql: SQL,
  suppressionKey: string
): Promise<SuppressionEntry | null> {
  const [row] = await sql`
    SELECT * FROM suppression_ledger
    WHERE suppression_key = ${suppressionKey}`;
  return row ? rowToSuppression(row as SuppressionRow) : null;
}

/**
 * Insert a new suppression entry, or — if one exists — bump the rejection
 * count, refresh `last_rejected_at`, and extend `next_eligible_at` to the
 * later of the existing value and the proposed one (never shrink the
 * cooldown). This is a single statement, so it is concurrency-safe.
 */
export async function upsertSuppression(
  sql: SQL,
  input: SuppressionUpsertInput
): Promise<SuppressionEntry> {
  await sql`
    INSERT INTO suppression_ledger (
      suppression_key, repo_installation_id, kind,
      last_rejected_at, rejection_reason, rejection_count, next_eligible_at
    )
    VALUES (
      ${input.suppressionKey}, ${input.repoInstallationId}, ${input.kind},
      NOW(), ${input.rejectionReason ?? null}, 1, ${input.nextEligibleAt}::timestamptz
    )
    ON CONFLICT (suppression_key) DO UPDATE SET
      last_rejected_at = NOW(),
      rejection_reason = COALESCE(EXCLUDED.rejection_reason, suppression_ledger.rejection_reason),
      rejection_count  = suppression_ledger.rejection_count + 1,
      next_eligible_at = GREATEST(suppression_ledger.next_eligible_at, EXCLUDED.next_eligible_at)`;

  const [row] = await sql`
    SELECT * FROM suppression_ledger WHERE suppression_key = ${input.suppressionKey}`;
  return rowToSuppression(row as SuppressionRow);
}
