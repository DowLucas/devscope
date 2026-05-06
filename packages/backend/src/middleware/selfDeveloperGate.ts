import type { SQL } from "bun";
import type { Context } from "hono";
import { getAllDeveloperIdsForUser } from "../services/developerLink";

/**
 * Resolves a `developerId` query parameter for per-developer endpoints under
 * a self-only access policy.
 *
 * Per the DevScope mission constraint (no individual surveillance, no
 * leaderboard surfaces), per-developer breakdown data is restricted to the
 * developer themselves. A non-self viewer asking for `developerId=X` is
 * denied outright rather than silently downgraded — silent downgrade is
 * misleading UX, and a clear 403 makes the policy explicit at the trust
 * boundary.
 *
 * Returns:
 *   - { allow: true, developerId: undefined } when no `developerId` is set
 *     (caller renders team-aggregate data).
 *   - { allow: true, developerId } when the requester owns that hash AND it
 *     belongs to the active org.
 *   - { allow: false, response } (a 403 JSON Response) otherwise — caller
 *     should `return gate.response`.
 */
export type SelfDeveloperGateResult =
  | { allow: true; developerId: string | undefined }
  | { allow: false; response: Response };

export async function gateSelfDeveloperId(
  c: Context,
  sql: SQL,
): Promise<SelfDeveloperGateResult> {
  const requested = c.req.query("developerId") || undefined;
  if (!requested) return { allow: true, developerId: undefined };

  const user = c.get("user" as never) as { id?: string } | undefined;
  const orgDevIds = c.get("orgDeveloperIds" as never) as string[] | undefined;

  const viewerDevIds = user?.id
    ? await getAllDeveloperIdsForUser(sql, user.id)
    : [];

  const ownedByViewer = viewerDevIds.includes(requested);
  // If org scoping is in effect, the requested developer must also belong to
  // the active org. When org scoping is absent (e.g. unscoped routes), only
  // the self-ownership check applies.
  const inOrg =
    !orgDevIds || orgDevIds.length === 0 || orgDevIds.includes(requested);

  if (!ownedByViewer || !inOrg) {
    return {
      allow: false,
      response: c.json(
        {
          error:
            "Per-developer detail is restricted to the developer themselves.",
        },
        403,
      ),
    };
  }
  return { allow: true, developerId: requested };
}
