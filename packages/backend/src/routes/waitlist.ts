import { Hono } from "hono";
import type { SQL } from "bun";

const USER_LIMIT = Number(process.env.USER_LIMIT ?? 100);

let cachedStatus: { data: unknown; expiresAt: number } | null = null;

export function waitlistRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/registration-status", async (c) => {
    const now = Date.now();
    if (!cachedStatus || cachedStatus.expiresAt <= now) {
      const [row] = await sql`SELECT COUNT(*)::INT as cnt FROM auth_user`;
      const userCount = (row as any).cnt as number;
      cachedStatus = {
        data: { open: userCount < USER_LIMIT, userCount, limit: USER_LIMIT },
        expiresAt: now + 30_000,
      };
    }
    return c.json(cachedStatus.data);
  });

  app.post("/join", async (c) => {
    const body = await c.req.json().catch(() => null);
    const email: string | undefined = body?.email?.trim();
    const name: string | undefined = body?.name?.trim() || undefined;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ error: "Valid email is required" }, 400);
    }

    try {
      await sql`INSERT INTO waitlist (email, name) VALUES (${email}, ${name ?? null})`;
      return c.json({ ok: true });
    } catch (err: any) {
      if (err?.code === "23505") {
        // Unique violation — already on list
        return c.json({ error: "Already on waitlist" }, 409);
      }
      throw err;
    }
  });

  return app;
}
