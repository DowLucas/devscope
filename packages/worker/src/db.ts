import { SQL } from "bun";

/**
 * Lazy `Bun.sql` factory for the worker. Mirrors the backend's connection
 * style (see packages/backend/src/db/schema.ts) but without running migrations
 * — the backend owns schema. The worker is a strict consumer.
 */
export function makePostgresClient(databaseUrl?: string): SQL {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required to start the worker");
  }
  return new SQL({ url, max: 5 });
}
