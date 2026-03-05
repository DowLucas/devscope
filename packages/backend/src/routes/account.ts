import { Hono } from "hono";
import type { SQL } from "bun";
import { rateLimitMiddleware } from "../middleware/rateLimit";

export function accountRoutes(sql: SQL) {
  const app = new Hono();

  app.use("/", rateLimitMiddleware({
    maxRequests: 3,
    windowMs: 60 * 60_000, // 1 hour
    prefix: "account-delete",
    keyFn: (c) => (c.get("user" as never) as any)?.id ?? "unknown",
  }));

  /**
   * DELETE /api/account
   *
   * Soft-deletes the authenticated user's account by setting
   * `marked_for_deletion_at`. All sessions are immediately revoked so the
   * user is logged out everywhere.
   */
  app.delete("/", async (c) => {
    const user = c.get("user" as never) as any;
    if (!user?.id) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await sql`
      UPDATE auth_user
      SET marked_for_deletion_at = NOW()
      WHERE id = ${user.id}
    `;

    // Revoke all sessions — forces the user to be logged out everywhere
    await sql`
      DELETE FROM auth_session
      WHERE "userId" = ${user.id}
    `;

    return c.json({ success: true });
  });

  return app;
}
