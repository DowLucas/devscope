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

  for (const file of files) {
    const migration = readFileSync(join(migrationsDir, file), "utf-8");
    await sql.unsafe(migration);
  }

  // Clear prepared statement cache after schema changes to prevent
  // "cached plan must not change result type" errors
  await sql.unsafe("DISCARD ALL");

  return sql;
}
