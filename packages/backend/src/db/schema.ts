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

  // Separate index-only migrations (can be deferred) from schema migrations (must run before server starts)
  const deferredIndexFiles: string[] = [];
  for (const file of files) {
    const migration = readFileSync(join(migrationsDir, file), "utf-8");
    const statements = migration
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    // If every statement is CREATE INDEX, defer it to run after server starts
    const allIndexes = statements.every((s) => /^CREATE\s+INDEX/i.test(s));
    if (allIndexes && statements.length > 0) {
      deferredIndexFiles.push(file);
      continue;
    }

    await sql.unsafe(migration);
  }

  // Clear prepared statement cache after schema changes to prevent
  // "cached plan must not change result type" errors
  await sql.unsafe("DISCARD ALL");

  // Run deferred index migrations in the background (non-blocking)
  if (deferredIndexFiles.length > 0) {
    (async () => {
      for (const file of deferredIndexFiles) {
        const migration = readFileSync(join(migrationsDir, file), "utf-8");
        const statements = migration
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !s.startsWith("--"));
        for (const stmt of statements) {
          try {
            await sql.unsafe(stmt);
          } catch (e) {
            console.error(`[migrations] Deferred index failed (${file}):`, (e as Error).message);
          }
        }
      }
      console.log(`[migrations] Deferred indexes complete: ${deferredIndexFiles.join(", ")}`);
    })();
  }

  return sql;
}
