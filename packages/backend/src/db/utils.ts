import { sql as Sql } from "bun";

/**
 * Build a safe SQL fragment for WHERE column IN (...) with string IDs.
 * Bun.sql's `IN (${array})` silently fails — it serializes the JS array
 * as a single comma-separated string parameter, matching zero rows.
 * This helper uses Sql.unsafe with validated hex-only IDs.
 */
const HEX_PATTERN = /^[a-f0-9]+$/;

export function inList(ids: string[]): ReturnType<typeof Sql.unsafe> {
  for (const id of ids) {
    if (typeof id !== "string" || !HEX_PATTERN.test(id)) {
      throw new Error(`inList: invalid ID format: ${id}`);
    }
  }
  const escaped = ids.map(id => `'${id}'`).join(",");
  return Sql.unsafe(escaped);
}
