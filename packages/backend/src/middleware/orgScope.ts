import type { SQL } from "bun";
import type { Context, Next } from "hono";
import { auth } from "../auth";
import { getOrgDeveloperIds } from "../services/developerLink";

/**
 * Middleware that extracts the active organization from the session
 * and resolves the org's developer IDs onto the context.
 */
export function orgScopeMiddleware(sql: SQL) {
  return async (c: Context, next: Next) => {
    const session = c.get("session" as never) as any;
    const orgId = session?.activeOrganizationId;

    if (orgId) {
      const devIds = await getOrgDeveloperIds(sql, orgId);
      c.set("orgId" as never, orgId as never);
      c.set("orgDeveloperIds" as never, devIds as never);
    }

    return next();
  };
}

/**
 * Middleware that requires the caller to be an admin or owner of the active org.
 */
export function requireOrgAdmin(sql: SQL) {
  return async (c: Context, next: Next) => {
    const session = c.get("session" as never) as any;
    const user = c.get("user" as never) as any;
    const orgId = session?.activeOrganizationId;

    if (!orgId || !user?.id) {
      return c.json({ error: "No active organization" }, 403);
    }

    const [membership] = await sql`
      SELECT role FROM member
      WHERE "organizationId" = ${orgId} AND "userId" = ${user.id}
      LIMIT 1`;

    const role = (membership as any)?.role;
    if (role !== "admin" && role !== "owner") {
      return c.json({ error: "Admin access required" }, 403);
    }

    return next();
  };
}

/**
 * Middleware that requires the caller to be a member of the active org.
 */
export function requireOrgMember(sql: SQL) {
  return async (c: Context, next: Next) => {
    const session = c.get("session" as never) as any;
    const user = c.get("user" as never) as any;
    const orgId = session?.activeOrganizationId;

    if (!orgId || !user?.id) {
      return c.json({ error: "No active organization" }, 403);
    }

    const [membership] = await sql`
      SELECT role FROM member
      WHERE "organizationId" = ${orgId} AND "userId" = ${user.id}
      LIMIT 1`;

    if (!membership) {
      return c.json({ error: "Not a member of this organization" }, 403);
    }

    c.set("orgRole" as never, (membership as any).role as never);
    return next();
  };
}
