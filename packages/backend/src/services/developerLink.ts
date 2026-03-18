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

export async function getAllDeveloperIdsForUser(sql: SQL, authUserId: string): Promise<string[]> {
  const rows = await sql`
    SELECT developer_id FROM user_developer_link WHERE auth_user_id = ${authUserId}`;
  return (rows as any[]).map((r) => r.developer_id);
}

export async function getLinkedDevelopersForUser(
  sql: SQL,
  authUserId: string,
  orgId: string
): Promise<{ developer_id: string; name: string; email: string }[]> {
  const rows = await sql`
    SELECT d.id AS developer_id, d.name, d.email
    FROM user_developer_link udl
    JOIN developers d ON d.id = udl.developer_id
    JOIN organization_developer od ON od.developer_id = udl.developer_id
    WHERE udl.auth_user_id = ${authUserId}
      AND od.organization_id = ${orgId}`;
  return rows as any[];
}

export async function unlinkDeveloperFromUser(
  sql: SQL,
  authUserId: string,
  developerId: string,
  orgId: string
): Promise<boolean> {
  // Verify the developer belongs to the caller's organization
  const [inOrg] = await sql`
    SELECT 1 FROM organization_developer
    WHERE organization_id = ${orgId} AND developer_id = ${developerId}`;
  if (!inOrg) return false;

  const result = await sql`
    DELETE FROM user_developer_link
    WHERE auth_user_id = ${authUserId} AND developer_id = ${developerId}
    RETURNING developer_id`;
  return result.length > 0;
}

export async function linkAdditionalEmail(
  sql: SQL,
  authUserId: string,
  email: string,
  orgId: string
): Promise<{ developerId: string } | { error: string }> {
  const developerId = computeDeveloperId(email);

  // Verify developer exists in this org
  const [exists] = await sql`
    SELECT 1 FROM organization_developer
    WHERE organization_id = ${orgId} AND developer_id = ${developerId}`;
  if (!exists) {
    return { error: "No developer found with this email in your organization" };
  }

  // Atomically attempt the link; conflict on the UNIQUE(developer_id) constraint
  // means another user already owns this developer
  const inserted = await sql`
    INSERT INTO user_developer_link (auth_user_id, developer_id)
    VALUES (${authUserId}, ${developerId})
    ON CONFLICT (developer_id) DO NOTHING
    RETURNING auth_user_id`;

  if (inserted.length > 0) {
    return { developerId };
  }

  // Row already exists — check if it belongs to this user (idempotent re-link)
  const [existing] = await sql`
    SELECT auth_user_id FROM user_developer_link
    WHERE developer_id = ${developerId}`;
  if (existing && (existing as any).auth_user_id === authUserId) {
    return { developerId };
  }

  return { error: "This developer is already linked to another account" };
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
