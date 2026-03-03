import { sql as Sql } from "bun";

/**
 * Build a safe SQL fragment for WHERE column IN (...) with string IDs.
 * Bun.sql's `IN (${array})` silently fails — it serializes the JS array
 * as a single comma-separated string parameter, matching zero rows.
 * This helper uses Sql.unsafe with proper single-quote escaping.
 */
export function inList(ids: string[]): ReturnType<typeof Sql.unsafe> {
  const escaped = ids.map(id => `'${id.replace(/'/g, "''")}'`).join(",");
  return Sql.unsafe(escaped);
}
