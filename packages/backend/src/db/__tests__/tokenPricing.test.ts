/**
 * Integration tests for token_pricing model_pattern matching (DEV-99).
 *
 * Verifies that updateSessionTokens picks the right pricing row for a
 * session based on its `model` column, and falls back to the '*' row
 * for unknown / NULL models.
 *
 * Gated on TEST_DATABASE_URL — the unit suite has no live DB. To run:
 *
 *   TEST_DATABASE_URL=postgres://devscope:devscope@localhost:5432/devscope_test \
 *     bun test packages/backend/src/db/__tests__/tokenPricing.test.ts
 *
 * If the env var is unset the suite is skipped, mirroring aiQueries.test.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { initializeDatabase } from "../schema";
import { updateSessionTokens } from "../queries";

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

d("token_pricing — model_pattern matching (DEV-99)", () => {
  let sqlPromise: ReturnType<typeof initializeDatabase> | null = null;
  const getSql = () => (sqlPromise ??= initializeDatabase(dbUrl!));

  // Use a unique developer id per test run so parallel runs don't collide.
  const devId = `t-dev-${crypto.randomUUID()}`;
  const sessionIds: string[] = [];

  beforeAll(async () => {
    const sql = await getSql();
    // Minimal developer row so the FK on sessions.developer_id holds.
    await sql`INSERT INTO developers (id, name, email) VALUES (${devId}, 'pricing-test', ${`${devId}@test.local`}) ON CONFLICT (id) DO NOTHING`;
  });

  afterAll(async () => {
    if (!sqlPromise) return;
    const sql = await sqlPromise;
    if (sessionIds.length > 0) {
      await sql.unsafe(
        `DELETE FROM sessions WHERE id = ANY($1::text[])`,
        [sessionIds]
      );
    }
    await sql`DELETE FROM developers WHERE id = ${devId}`;
  });

  /**
   * Insert a session with the given model, run updateSessionTokens with a
   * known input-only token budget, and return the resulting
   * estimated_cost_usd as a number.
   */
  async function costFor(model: string | null, inputTokens: number) {
    const sql = await getSql();
    const sessionId = `t-sess-${crypto.randomUUID()}`;
    sessionIds.push(sessionId);

    await sql`
      INSERT INTO sessions (id, developer_id, project_path, project_name, started_at, model)
      VALUES (${sessionId}, ${devId}, '/tmp/x', 'x', NOW(), ${model})
    `;

    await updateSessionTokens(sql, sessionId, {
      inputTokens,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });

    const [row] = await sql`SELECT estimated_cost_usd FROM sessions WHERE id = ${sessionId}` as any[];
    return Number(row.estimated_cost_usd);
  }

  test("a Sonnet-4 session uses the sonnet-4 row ($3 / Mtok input)", async () => {
    // 1,000,000 input tokens at $3/Mtok = $3.00.
    const cost = await costFor("claude-sonnet-4-20250514", 1_000_000);
    expect(cost).toBeCloseTo(3.0, 4);
  });

  test("an Opus-4 session uses the opus-4 row ($15 / Mtok input)", async () => {
    const cost = await costFor("claude-opus-4-6", 1_000_000);
    expect(cost).toBeCloseTo(15.0, 4);
  });

  test("a Haiku-4.5 session uses the haiku-4-5 row ($1 / Mtok input)", async () => {
    const cost = await costFor("claude-haiku-4-5-20251001", 1_000_000);
    expect(cost).toBeCloseTo(1.0, 4);
  });

  test("an unknown model falls back to the '*' row (Sonnet-4 fallback rates)", async () => {
    const cost = await costFor("claude-something-future-7", 1_000_000);
    // Fallback row is seeded at Sonnet-4 rates ($3/Mtok input).
    expect(cost).toBeCloseTo(3.0, 4);
  });

  test("a NULL model falls back to the '*' row", async () => {
    const cost = await costFor(null, 1_000_000);
    expect(cost).toBeCloseTo(3.0, 4);
  });
});
