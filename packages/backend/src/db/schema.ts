import { SQL } from "bun";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

export async function initializeDatabase(databaseUrl?: string): Promise<SQL> {
  // Close previous pool on hot-reload to prevent connection exhaustion
  const g = globalThis as Record<string, any>;
  if (g.__gc_sql) {
    try { g.__gc_sql.close(); } catch {}
  }

  const sql = new SQL({
    url: databaseUrl || process.env.DATABASE_URL,
    max: 20,
  });

  g.__gc_sql = sql;

  const migrationsDir = join(import.meta.dir, "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Run schema migrations synchronously (must complete before server starts).
  // Index-only migrations (file contains only CREATE INDEX statements and comments)
  // are deferred to run after the server starts to avoid healthcheck timeouts.
  const deferred: Array<{ file: string; content: string }> = [];
  for (const file of files) {
    const content = readFileSync(join(migrationsDir, file), "utf-8");

    // Check if this migration only creates indexes (safe to defer)
    const stripped = content.replace(/--[^\n]*/g, "").trim();
    const isIndexOnly = stripped.length > 0 && stripped
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .every((s) => /^CREATE\s+INDEX/i.test(s));

    if (isIndexOnly) {
      deferred.push({ file, content });
    } else {
      await sql.unsafe(content);
    }
  }

  // Clear prepared statement cache after schema changes
  await sql.unsafe("DISCARD ALL");

  // Run index migrations in the background — server can start serving immediately
  if (deferred.length > 0) {
    (async () => {
      for (const { file, content } of deferred) {
        try {
          await sql.unsafe(content);
          console.log(`[migrations] Index migration complete: ${file}`);
        } catch (e) {
          console.error(`[migrations] Index migration failed (${file}):`, (e as Error).message);
        }
      }
    })();
  }

  return sql;
}
