import type { SQL } from "bun";
import { auth } from "../auth";
import { linkUserToDeveloper } from "../services/developerLink";

export async function seedDefaultAdmin(sql: SQL): Promise<void> {
  const [row] = await sql`SELECT COUNT(*)::INT AS cnt FROM auth_user`;
  if ((row as any)?.cnt > 0) return;

  const email = process.env.DEVSCOPE_ADMIN_EMAIL ?? "admin@devscope.local";
  const password = process.env.DEVSCOPE_ADMIN_PASSWORD ?? "changeme123!";
  const name = process.env.DEVSCOPE_ADMIN_NAME ?? "Admin";
  const orgName = process.env.DEVSCOPE_ORG_NAME ?? "DevScope";

  try {
    // Create admin user via better-auth API
    const signupRes = await auth.api.signUpEmail({ body: { email, password, name } });
    const userId = signupRes?.user?.id;
    if (!userId) throw new Error("No user ID returned from signup");
    console.log(`[devscope] Default admin seeded (${email})`);

    // Create organization directly via SQL — the better-auth server-side API
    // requires a full HTTP session context which isn't available during seeding
    const orgId = crypto.randomUUID();
    const slug = orgName.toLowerCase().replace(/\s+/g, "-");
    const now = new Date().toISOString();

    await sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${orgId}, ${orgName}, ${slug}, ${now})`;
    await sql`INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES (${crypto.randomUUID()}, ${orgId}, ${userId}, 'owner', ${now})`;
    await sql`INSERT INTO organization_settings (organization_id) VALUES (${orgId})`;

    // Link admin to developer identity
    await linkUserToDeveloper(sql, userId, email, name, orgId);

    console.log(`[devscope] Default organization "${orgName}" created with admin as owner`);
  } catch (err) {
    console.error("[devscope] Failed to seed admin:", err);
  }
}
