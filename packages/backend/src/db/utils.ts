import { sql as Sql } from "bun";

/**
 * Build a safe SQL fragment for WHERE column IN (...) with string IDs.
 * Bun.sql's `IN (${array})` silently fails — it serializes the JS array
 * as a single comma-separated string parameter, matching zero rows.
 * This helper uses Sql.unsafe with escaped single quotes.
 */
export function inList(ids: string[]): ReturnType<typeof Sql.unsafe> {
  return Sql.unsafe(quoteIds(ids));
}

/** Escaped, comma-separated string literals for an IN list ("NULL" when empty). */
export function quoteIds(ids: string[]): string {
  if (ids.length === 0) return "NULL";
  return ids.map(id => `'${id.replace(/'/g, "''")}'`).join(",");
}

/**
 * SQL predicate: session `alias` is not activity-only for this viewer (see
 * services/visibility.ts — owner, or opted in and not private). Used by
 * aggregates to decide whether a session's project may be named.
 */
export function visibleSessionPredicate(viewerDevIds: string[], alias = "s"): string {
  const own = viewerDevIds.length > 0 ? `${alias}.developer_id IN (${quoteIds(viewerDevIds)}) OR ` : "";
  return (
    `(${own}(COALESCE(${alias}.privacy_mode, '') <> 'private' AND EXISTS (` +
    `SELECT 1 FROM developers vis_d WHERE vis_d.id = ${alias}.developer_id AND vis_d.share_details = TRUE)))`
  );
}

/** `visibleSessionPredicate` as a fragment for Bun.sql templates. */
export function visibleSessionSql(viewerDevIds: string[], alias = "s"): ReturnType<typeof Sql.unsafe> {
  return Sql.unsafe(visibleSessionPredicate(viewerDevIds, alias));
}
