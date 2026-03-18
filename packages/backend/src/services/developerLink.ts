import type { SQL } from "bun";

export function computeDeveloperId(email: string): string {
  const normalized = email.toLowerCase().trim();
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(normalized);
  return hash.digest("hex");
}

export async function linkUserToDeveloper(
  sql: SQL,
  authUserId: string,
  email: string,
  name: string,
  orgId: string
): Promise<string> {
  const developerId = computeDeveloperId(email);

  // Upsert into developers table (same as plugin behavior)
  await sql`
    INSERT INTO developers (id, name, email, first_seen, last_seen)
    VALUES (${developerId}, ${name}, ${email}, NOW(), NOW())
    ON CONFLICT(id) DO UPDATE SET
      name = ${name},
      email = CASE WHEN ${email} != '' THEN ${email} ELSE developers.email END,
      last_seen = NOW()`;

  // Link auth user to developer
  await sql`
    INSERT INTO user_developer_link (auth_user_id, developer_id)
    VALUES (${authUserId}, ${developerId})
    ON CONFLICT DO NOTHING`;

  // Link developer to organization
  await sql`
    INSERT INTO organization_developer (organization_id, developer_id)
    VALUES (${orgId}, ${developerId})
    ON CONFLICT DO NOTHING`;

  return developerId;
}

export async function getDeveloperIdForUser(sql: SQL, authUserId: string): Promise<string | null> {
  const [row] = await sql`
    SELECT developer_id FROM user_developer_link WHERE auth_user_id = ${authUserId} LIMIT 1`;
  return (row as any)?.developer_id ?? null;
}

export async function getOrgDeveloperIds(sql: SQL, orgId: string): Promise<string[]> {
  const rows = await sql`
    SELECT developer_id FROM organization_developer WHERE organization_id = ${orgId}`;
  return (rows as any[]).map((r) => r.developer_id);
}

export async function autoLinkUserToDeveloper(
  sql: SQL,
  authUserId: string,
  developerId: string
): Promise<void> {
  const [authUser] = await sql`
    SELECT email FROM auth_user WHERE id = ${authUserId}` as { email?: string }[];
  if (!authUser?.email) return;

  const authEmail = authUser.email;

  // Only auto-link if the auth user's email produces the same developer ID
  const expectedDevId = computeDeveloperId(authEmail);
  if (expectedDevId === developerId) {
    await sql`
      INSERT INTO user_developer_link (auth_user_id, developer_id)
      VALUES (${authUserId}, ${developerId})
      ON CONFLICT DO NOTHING`;
  }
}

export async function autoLinkDeveloperToOrg(
  sql: SQL,
  authUserId: string,
  developerId: string
): Promise<void> {
  const orgs = await sql`
    SELECT "organizationId" FROM member WHERE "userId" = ${authUserId} LIMIT 1`;
  if (orgs.length > 0) {
    const orgId = (orgs[0] as any).organizationId;
    await sql`
      INSERT INTO organization_developer (organization_id, developer_id)
      VALUES (${orgId}, ${developerId})
      ON CONFLICT DO NOTHING`;
  }
}
