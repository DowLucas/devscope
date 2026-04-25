/**
 * GitHub App install flow routes.
 *
 * Three endpoints:
 *   GET  /start          — admin-only; redirects to GitHub's install page
 *                          carrying a short-lived HMAC state token.
 *   GET  /callback       — GitHub redirects here after install/update.
 *                          Verifies state, fetches granted repos via the App
 *                          installation, bulk-upserts repo_installations.
 *   DELETE /:id          — admin-only; soft-suspends an install (audit-safe).
 *
 * Audit trail: every meaningful state transition writes to `audit_log`
 * tagged with `POLICY_VERSION` from services/githubApp.ts.
 */

import { Hono } from "hono";
import type { SQL } from "bun";
import {
  upsertRepoInstallation,
  suspendRepoInstallation,
  getRepoInstallation,
} from "../db/repoInstallationQueries";
import { insertAuditEntry } from "../db/auditLogQueries";
import { octokitForInstallation, POLICY_VERSION } from "../services/githubApp";

// ---------------------------------------------------------------------------
// State token (HMAC-SHA256 over `${orgId}|${userId}|${nonce}|${expUnix}`)
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 10 * 60 * 1000;

function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

function readSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set; cannot sign install state token");
  return s;
}

interface StatePayload {
  organizationId: string;
  userId: string;
  nonce: string;
  expiresAtUnix: number;
}

async function hmac(payloadStr: string): Promise<Buffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(readSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadStr));
  return Buffer.from(sig);
}

export async function buildStateToken(orgId: string, userId: string, now = Date.now()): Promise<string> {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = Buffer.from(nonceBytes).toString("hex");
  const expiresAtUnix = Math.floor((now + STATE_TTL_MS) / 1000);
  const payloadStr = `${orgId}|${userId}|${nonce}|${expiresAtUnix}`;
  const sig = await hmac(payloadStr);
  return `${b64url(Buffer.from(payloadStr))}.${b64url(sig)}`;
}

export async function verifyStateToken(
  token: string,
  now = Date.now()
): Promise<{ ok: true; payload: StatePayload } | { ok: false; error: string }> {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, error: "Malformed state token" };
  const [payloadB64, sigB64] = parts;
  let payloadStr: string;
  let sigBuf: Buffer;
  try {
    payloadStr = Buffer.from(payloadB64, "base64url").toString("utf8");
    sigBuf = Buffer.from(sigB64, "base64url");
  } catch {
    return { ok: false, error: "State token decode failed" };
  }

  const expected = await hmac(payloadStr);
  if (expected.length !== sigBuf.length) return { ok: false, error: "State signature mismatch" };
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ sigBuf[i];
  if (diff !== 0) return { ok: false, error: "State signature mismatch" };

  const fields = payloadStr.split("|");
  if (fields.length !== 4) return { ok: false, error: "Malformed state payload" };
  const [organizationId, userId, nonce, expStr] = fields;
  const expiresAtUnix = Number(expStr);
  if (!Number.isFinite(expiresAtUnix)) return { ok: false, error: "Invalid expiry" };
  if (expiresAtUnix * 1000 < now) return { ok: false, error: "State token expired" };

  return { ok: true, payload: { organizationId, userId, nonce, expiresAtUnix } };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function userIsOrgAdmin(sql: SQL, orgId: string, userId: string): Promise<boolean> {
  const [row] = await sql`
    SELECT role FROM member
    WHERE "organizationId" = ${orgId} AND "userId" = ${userId}
    LIMIT 1`;
  const role = (row as { role?: string } | undefined)?.role;
  return role === "admin" || role === "owner";
}

function dashboardUrl(): string {
  const fromEnv = process.env.DASHBOARD_URL ?? process.env.GC_CORS_ORIGIN ?? "http://localhost:5173";
  // Take the first origin if comma-separated.
  return fromEnv.split(",")[0].trim().replace(/\/$/, "");
}

function readAppName(): string {
  const v = process.env.GITHUB_APP_NAME;
  if (!v) throw new Error("GITHUB_APP_NAME is not set; cannot redirect to GitHub install page");
  return v;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function githubInstallRoutes(sql: SQL) {
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /start — admin-only; 302 → GitHub install page
  // -------------------------------------------------------------------------
  app.get("/start", async (c) => {
    const user = c.get("user" as never) as { id?: string } | undefined;
    const session = c.get("session" as never) as { activeOrganizationId?: string } | undefined;
    const userId = user?.id;
    const orgId = session?.activeOrganizationId;

    if (!userId || !orgId) {
      return c.json({ error: "No active organization" }, 403);
    }

    if (!(await userIsOrgAdmin(sql, orgId, userId))) {
      return c.json({ error: "Admin access required" }, 403);
    }

    let appName: string;
    try {
      appName = readAppName();
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }

    const stateToken = await buildStateToken(orgId, userId);

    await insertAuditEntry(sql, {
      actor: userId,
      action: "github.install.start",
      policyVersion: POLICY_VERSION,
      details: { organizationId: orgId },
    });

    const target = `https://github.com/apps/${encodeURIComponent(appName)}/installations/new?state=${encodeURIComponent(stateToken)}`;
    return c.redirect(target, 302);
  });

  // -------------------------------------------------------------------------
  // GET /callback — verify state, list repos, bulk-upsert, redirect
  // -------------------------------------------------------------------------
  app.get("/callback", async (c) => {
    const installationIdRaw = c.req.query("installation_id");
    const stateToken = c.req.query("state");
    const setupAction = c.req.query("setup_action");

    if (!installationIdRaw || !stateToken) {
      return c.json({ error: "Missing installation_id or state" }, 400);
    }
    const installationId = Number(installationIdRaw);
    if (!Number.isFinite(installationId) || installationId <= 0) {
      return c.json({ error: "Invalid installation_id" }, 400);
    }
    if (setupAction && setupAction !== "install" && setupAction !== "update") {
      return c.json({ error: `Unsupported setup_action: ${setupAction}` }, 400);
    }

    const verified = await verifyStateToken(stateToken);
    if (!verified.ok) {
      return c.json({ error: verified.error }, 400);
    }
    const { organizationId, userId } = verified.payload;

    // Re-verify admin role — could have been revoked between start and callback.
    if (!(await userIsOrgAdmin(sql, organizationId, userId))) {
      return c.json({ error: "Admin access required" }, 403);
    }

    // List repos GitHub granted to this installation.
    const octokit = await octokitForInstallation(sql, installationId);
    const reposResp = await octokit.request("GET /installation/repositories", { per_page: 100 });
    const repos = (reposResp.data?.repositories ?? []) as Array<{
      owner: { login: string };
      name: string;
      default_branch: string;
    }>;

    let nRepos = 0;
    for (const repo of repos) {
      const owner = repo.owner?.login;
      const name = repo.name;
      const defaultBranch = repo.default_branch ?? "main";
      if (!owner || !name) continue;

      const id = crypto.randomUUID();
      const upserted = await upsertRepoInstallation(sql, {
        id,
        organizationId,
        githubInstallId: installationId,
        owner,
        repo: name,
        defaultBranch,
        cwdPatterns: [],
        isLive: false,
        autoOpenPrKinds: [],
        conventionProfile: {},
      });

      await insertAuditEntry(sql, {
        actor: userId,
        action: "github.install.callback",
        policyVersion: POLICY_VERSION,
        repoInstallationId: upserted.id,
        details: { owner, repo: name, githubInstallId: installationId },
      });
      nRepos++;
    }

    const target = `${dashboardUrl()}/dashboard/proposed-changes/settings?installed=1&count=${nRepos}`;
    return c.redirect(target, 302);
  });

  // -------------------------------------------------------------------------
  // DELETE /:id — admin of the install's owning org marks it suspended
  // -------------------------------------------------------------------------
  app.delete("/:id", async (c) => {
    const user = c.get("user" as never) as { id?: string } | undefined;
    const userId = user?.id;
    const id = c.req.param("id");
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const install = await getRepoInstallation(sql, id);
    if (!install) return c.json({ error: "Not found" }, 404);

    // Admin check against the install's OWNING org — not the active session org.
    // A user may admin multiple orgs and have installs across them.
    if (!(await userIsOrgAdmin(sql, install.organizationId, userId))) {
      return c.json({ error: "Admin access required" }, 403);
    }

    const result = await suspendRepoInstallation(sql, id);
    if (!result) return c.json({ error: "Not found" }, 404);

    await insertAuditEntry(sql, {
      actor: userId,
      action: "github.install.suspend",
      policyVersion: POLICY_VERSION,
      repoInstallationId: id,
      details: {},
    });

    return c.json({ id: result.id, suspendedAt: result.suspendedAt });
  });

  return app;
}
