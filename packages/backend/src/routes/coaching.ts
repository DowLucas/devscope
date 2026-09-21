import { Hono } from "hono";
import type { SQL } from "bun";
import { getAllDeveloperIdsForUser } from "../services/developerLink";
import { inList } from "../db/utils";
import type { CoachingRecommendation } from "../ai/workflows/coachingCardWorkflow";

interface CoachingCardRow {
  id: string;
  developer_id: string;
  organization_id: string;
  week_start: string;
  recommendations: CoachingRecommendation[] | string;
  generated_at: string;
  viewed_at: string | null;
}

function shapeRow(row: CoachingCardRow) {
  let recs: CoachingRecommendation[] = [];
  if (Array.isArray(row.recommendations)) {
    recs = row.recommendations;
  } else if (typeof row.recommendations === "string") {
    try {
      recs = JSON.parse(row.recommendations);
    } catch {
      recs = [];
    }
  }
  return {
    id: row.id,
    developer_id: row.developer_id,
    week_start: row.week_start,
    recommendations: recs,
    generated_at: row.generated_at,
    viewed_at: row.viewed_at,
  };
}

/**
 * Coaching cards are self-only by design:
 * - No `developer_id` query parameter is accepted on any endpoint.
 * - The dev_id is resolved from the authenticated user via user_developer_link.
 * - Org admins cannot impersonate or view another developer's card.
 *
 * This is enforced by deriving the allowed dev_id list from the session, never the URL.
 */
export function coachingRoutes(sql: SQL) {
  const app = new Hono();

  async function callerDevIds(c: any): Promise<string[] | null> {
    const user = c.get("user") as { id?: string } | undefined;
    if (!user?.id) return null;
    const devIds = await getAllDeveloperIdsForUser(sql, user.id);
    return devIds.length > 0 ? devIds : [];
  }

  app.get("/me", async (c) => {
    const devIds = await callerDevIds(c);
    if (devIds === null) return c.json({ error: "Unauthorized" }, 401);
    if (devIds.length === 0) return c.json({ card: null });

    const rows = (await sql`
      SELECT id, developer_id, organization_id,
        week_start::TEXT as week_start,
        recommendations,
        generated_at::TEXT as generated_at,
        viewed_at::TEXT as viewed_at
      FROM coaching_cards
      WHERE developer_id IN (${inList(devIds)})
      ORDER BY week_start DESC
      LIMIT 1`) as CoachingCardRow[];

    return c.json({ card: rows[0] ? shapeRow(rows[0]) : null });
  });

  app.get("/me/history", async (c) => {
    const devIds = await callerDevIds(c);
    if (devIds === null) return c.json({ error: "Unauthorized" }, 401);
    if (devIds.length === 0) return c.json({ cards: [] });

    const limit = Math.min(Number(c.req.query("limit") ?? 8), 26);
    const rows = (await sql`
      SELECT id, developer_id, organization_id,
        week_start::TEXT as week_start,
        recommendations,
        generated_at::TEXT as generated_at,
        viewed_at::TEXT as viewed_at
      FROM coaching_cards
      WHERE developer_id IN (${inList(devIds)})
      ORDER BY week_start DESC
      LIMIT ${limit}`) as CoachingCardRow[];

    return c.json({ cards: rows.map(shapeRow) });
  });

  app.post("/me/viewed", async (c) => {
    const devIds = await callerDevIds(c);
    if (devIds === null) return c.json({ error: "Unauthorized" }, 401);
    if (devIds.length === 0) return c.json({ ok: true });

    const body = await c.req.json().catch(() => ({}));
    const cardId = typeof body?.card_id === "string" ? body.card_id : null;
    if (!cardId) return c.json({ error: "card_id required" }, 400);

    // Only mark a card the caller owns
    await sql`
      UPDATE coaching_cards
      SET viewed_at = NOW()
      WHERE id = ${cardId}
        AND developer_id IN (${inList(devIds)})
        AND viewed_at IS NULL`;

    return c.json({ ok: true });
  });

  return app;
}
