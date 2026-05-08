#!/usr/bin/env bun
/**
 * dev-bootstrap.ts — Local-dev convenience for hitting the DevScope backend.
 *
 * USAGE
 *   bun run packages/backend/scripts/dev-bootstrap.ts [--email=<e>] [--password=<p>] [--org=<name>]
 *
 * What it does (idempotent):
 *   1. Ensures an admin user exists (re-uses an existing one by email if found).
 *   2. Ensures that user owns an organization with `member` row + `organization_settings`.
 *   3. Sets `activeOrganizationId` on every existing `auth_session` row for that user
 *      so any browser session you already have starts receiving WS broadcasts.
 *   4. Mints a fresh API key via `auth.api.createApiKey({ body: { userId, name } })`.
 *   5. Prints the API key once and a sample `curl` for `/api/events`.
 *
 * Defaults:
 *   email    = $DEVSCOPE_ADMIN_EMAIL    or admin@devscope.local
 *   password = $DEVSCOPE_ADMIN_PASSWORD or "changeme123!"
 *   org      = $DEVSCOPE_ORG_NAME       or "DevScope"
 *
 * REQUIREMENTS
 *   - DATABASE_URL set (same one the dev backend uses).
 *   - The backend does NOT need to be running. The script talks to the DB directly
 *     and uses the in-process better-auth `auth.api` for createApiKey/signUpEmail.
 *   - You can point the plugin at the freshly minted key:
 *       DEVSCOPE_URL=http://localhost:6767 DEVSCOPE_API_KEY=<key> ...
 *
 * NOTES
 *   - Per-run keys: nothing is written back to the repo, the key is only printed.
 *   - The default password is for local dev only. Override via env or --password.
 *   - DEV-69: see docs link in devscope/CLAUDE.md for the auth model.
 */

import { SQL } from "bun";
import { auth } from "../src/auth";

interface Args {
  email: string;
  password: string;
  orgName: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const a = argv.find((x) => x.startsWith(`--${flag}=`));
    return a ? a.slice(flag.length + 3) : undefined;
  };
  return {
    email: get("email") ?? process.env.DEVSCOPE_ADMIN_EMAIL ?? "admin@devscope.local",
    password: get("password") ?? process.env.DEVSCOPE_ADMIN_PASSWORD ?? "changeme123!",
    orgName: get("org") ?? process.env.DEVSCOPE_ORG_NAME ?? "DevScope",
  };
}

async function ensureUser(sql: SQL, args: Args, name = "Admin"): Promise<string> {
  const existing = (await sql`
    SELECT id FROM auth_user WHERE email = ${args.email} LIMIT 1
  `) as Array<{ id: string }>;
  if (existing.length > 0) {
    console.log(`[bootstrap] user exists  email=${args.email} id=${existing[0]!.id}`);
    return existing[0]!.id;
  }
  const res = await auth.api.signUpEmail({
    body: { email: args.email, password: args.password, name, acceptedTerms: true } as any,
  });
  const userId = (res as any)?.user?.id;
  if (!userId) throw new Error("signUpEmail returned no user id");
  console.log(`[bootstrap] user created  email=${args.email} id=${userId}`);
  return userId;
}

async function ensureOrg(sql: SQL, userId: string, orgName: string): Promise<string> {
  // Prefer an org this user already belongs to; otherwise create one.
  const existing = (await sql`
    SELECT o.id
    FROM organization o
    JOIN member m ON m."organizationId" = o.id
    WHERE m."userId" = ${userId}
    ORDER BY o."createdAt" ASC
    LIMIT 1
  `) as Array<{ id: string }>;
  if (existing.length > 0) {
    console.log(`[bootstrap] org exists  id=${existing[0]!.id}`);
    return existing[0]!.id;
  }

  const orgId = crypto.randomUUID();
  // Slugs must be unique; suffix with a short random tag if a slug collides.
  const baseSlug = orgName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const slug = `${baseSlug}-${orgId.slice(0, 8)}`;
  const now = new Date().toISOString();

  await sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${orgId}, ${orgName}, ${slug}, ${now})
  `;
  await sql`
    INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
    VALUES (${crypto.randomUUID()}, ${orgId}, ${userId}, 'owner', ${now})
  `;
  // organization_settings has a UNIQUE org_id; ON CONFLICT keeps the script idempotent.
  await sql`
    INSERT INTO organization_settings (organization_id) VALUES (${orgId})
    ON CONFLICT DO NOTHING
  `;
  console.log(`[bootstrap] org created  id=${orgId} slug=${slug}`);
  return orgId;
}

async function setActiveOrgOnExistingSessions(
  sql: SQL,
  userId: string,
  orgId: string,
): Promise<number> {
  // The DEV-69 trap: signing in via /api/auth/sign-in/email leaves
  // activeOrganizationId NULL, so the WS upgrade puts the client in no org bucket
  // and broadcasts go nowhere. Patch any sessions we already have so an open
  // browser tab works without the user having to POST /set-active manually.
  const r = (await sql`
    UPDATE auth_session
    SET "activeOrganizationId" = ${orgId}
    WHERE "userId" = ${userId}
      AND ("activeOrganizationId" IS NULL OR "activeOrganizationId" <> ${orgId})
  `) as { count?: number } | undefined;
  return r?.count ?? 0;
}

async function mintApiKey(userId: string, label: string): Promise<string> {
  const res = await auth.api.createApiKey({
    body: {
      name: label,
      userId,
    } as any,
  });
  const key = (res as any)?.key;
  if (!key || typeof key !== "string") {
    throw new Error("createApiKey did not return a `key` field");
  }
  return key;
}

function sampleCurl(apiKey: string, baseUrl: string): string {
  // Minimal /api/events POST body matching the plugin contract.
  // The backend zod schema requires id/timestamp/sessionId/developerId/etc.,
  // so we hand-roll a smoke event here for copy/paste.
  const body = JSON.stringify({
    id: "bootstrap-smoke",
    timestamp: new Date().toISOString(),
    sessionId: "bootstrap-session",
    developerId: "bootstrap-developer",
    developerName: "Bootstrap",
    developerEmail: "",
    projectPath: "/tmp/bootstrap",
    projectName: "bootstrap",
    eventType: "session.start",
    payload: {},
  });
  return [
    `curl -sS -X POST '${baseUrl}/api/events' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'x-api-key: ${apiKey}' \\`,
    `  -d '${body}'`,
  ].join("\n");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Refusing to run.");
    process.exit(2);
  }
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:6767";

  const sql = new SQL({ url, max: 4 });

  try {
    const userId = await ensureUser(sql, args);
    const orgId = await ensureOrg(sql, userId, args.orgName);
    const sessionsPatched = await setActiveOrgOnExistingSessions(sql, userId, orgId);
    console.log(
      `[bootstrap] sessions patched  count=${sessionsPatched} (set activeOrganizationId)`,
    );

    // Better-auth caps the api-key name length (~32 chars by default), so use a
    // short timestamp suffix instead of a full ISO string.
    const stamp = Math.floor(Date.now() / 1000).toString(36);
    const label = `dev-bootstrap-${stamp}`;
    const apiKey = await mintApiKey(userId, label);

    console.log("");
    console.log("=== DevScope local dev bootstrap ===");
    console.log(`  user.email   ${args.email}`);
    console.log(`  user.password ${args.password}    # local dev only`);
    console.log(`  user.id       ${userId}`);
    console.log(`  org.id        ${orgId}`);
    console.log(`  api.key.name  ${label}`);
    console.log("");
    console.log(`  api.key       ${apiKey}`);
    console.log("  ^^ this is shown ONCE; copy it now.");
    console.log("");
    console.log(`  baseUrl       ${baseUrl}`);
    console.log("");
    console.log("Sample curl (smoke /api/events):");
    console.log(sampleCurl(apiKey, baseUrl));
    console.log("");
    console.log("Plugin env (point a Claude Code session at this stack):");
    console.log(`  DEVSCOPE_URL=${baseUrl}`);
    console.log(`  DEVSCOPE_API_KEY=${apiKey}`);
  } finally {
    await sql.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
