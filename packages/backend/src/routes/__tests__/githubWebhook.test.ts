/**
 * Tests for /api/github/webhook.
 *
 * Strategy: mock the three lower layers (delivery dedupe, repo install
 * suspends, audit log). The route's own logic (HMAC verify, dispatch order,
 * error handling) is what's actually under test.
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Mocks — installed BEFORE importing the route under test.
// ---------------------------------------------------------------------------

const mockRecordDelivery = mock((_sql: any, _id: string, _event: string) =>
  Promise.resolve(true)
);
mock.module("../../db/webhookDeliveryQueries", () => ({
  recordDelivery: mockRecordDelivery,
}));

const mockSuspendInstallationByGithubId = mock((_sql: any, _id: number) =>
  Promise.resolve([{ id: "ri-1", organizationId: "org-1", suspendedAt: "2026-04-25T00:00:00Z" }])
);
const mockSuspendRepoInstallationsByGithubIdAndRepos = mock(
  (_sql: any, _id: number, _repos: any[]) =>
    Promise.resolve([{ id: "ri-1", organizationId: "org-1", suspendedAt: "2026-04-25T00:00:00Z" }])
);

mock.module("../../db/repoInstallationQueries", () => ({
  suspendInstallationByGithubId: mockSuspendInstallationByGithubId,
  suspendRepoInstallationsByGithubIdAndRepos: mockSuspendRepoInstallationsByGithubIdAndRepos,
  // Other exports — supplied so cross-imports don't break.
  insertRepoInstallation: mock(() => Promise.resolve(null)),
  upsertRepoInstallation: mock(() => Promise.resolve(null)),
  getRepoInstallation: mock(() => Promise.resolve(null)),
  getRepoInstallationByGithubId: mock(() => Promise.resolve(null)),
  listRepoInstallationsForOrg: mock(() => Promise.resolve([])),
  updateRepoInstallation: mock(() => Promise.resolve()),
  deleteRepoInstallation: mock(() => Promise.resolve()),
  suspendRepoInstallation: mock(() => Promise.resolve(null)),
  upsertInstallationToken: mock(() => Promise.resolve()),
  getInstallationToken: mock(() => Promise.resolve(null)),
  deleteInstallationToken: mock(() => Promise.resolve()),
}));

const mockInsertAuditEntry = mock((_sql: any, input: any) =>
  Promise.resolve({
    id: 1,
    at: "2026-04-25T00:00:00Z",
    actor: input.actor,
    action: input.action,
    repoInstallationId: input.repoInstallationId ?? null,
    artifactId: input.artifactId ?? null,
    policyVersion: input.policyVersion,
    details: input.details ?? null,
  })
);
mock.module("../../db/auditLogQueries", () => ({
  insertAuditEntry: mockInsertAuditEntry,
}));

mock.module("../../services/githubApp", () => ({
  POLICY_VERSION: "v1-test",
  // unused-but-imported-by-others
  octokitForInstallation: mock(() => Promise.resolve({} as any)),
  signAppJwt: mock(() => "test-jwt"),
  getInstallationToken: mock(() => Promise.resolve("test-token")),
  GithubInstallationUnavailableError: class extends Error {},
  _resetJwtCacheForTests: mock(() => {}),
  _resetOctokitCacheForTests: mock(() => {}),
}));

const { githubWebhookRoutes } = await import("../githubWebhook");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = "test-webhook-secret";
const ORIGINAL_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

beforeEach(() => {
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  mockRecordDelivery.mockClear();
  mockRecordDelivery.mockImplementation(() => Promise.resolve(true));
  mockSuspendInstallationByGithubId.mockClear();
  mockSuspendInstallationByGithubId.mockImplementation(() =>
    Promise.resolve([{ id: "ri-1", organizationId: "org-1", suspendedAt: "2026-04-25T00:00:00Z" }])
  );
  mockSuspendRepoInstallationsByGithubIdAndRepos.mockClear();
  mockSuspendRepoInstallationsByGithubIdAndRepos.mockImplementation(() =>
    Promise.resolve([{ id: "ri-1", organizationId: "org-1", suspendedAt: "2026-04-25T00:00:00Z" }])
  );
  mockInsertAuditEntry.mockClear();
});

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + Buffer.from(sig).toString("hex");
}

const sql: any = mock(() => Promise.resolve([]));

function buildApp() {
  const app = new Hono();
  app.route("/", githubWebhookRoutes(sql));
  return app;
}

async function post(opts: {
  body: any;
  signature?: string;
  delivery?: string;
  event?: string;
}) {
  const bodyStr = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.signature !== undefined) headers["x-hub-signature-256"] = opts.signature;
  if (opts.delivery !== undefined) headers["x-github-delivery"] = opts.delivery;
  if (opts.event !== undefined) headers["x-github-event"] = opts.event;
  return buildApp().request("/", {
    method: "POST",
    headers,
    body: bodyStr,
  });
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

describe("signature verification", () => {
  test("missing signature header returns 401 and never touches the DB", async () => {
    const res = await post({ body: { hello: "world" }, delivery: "d1", event: "ping" });
    expect(res.status).toBe(401);
    expect(mockRecordDelivery).not.toHaveBeenCalled();
    expect(mockInsertAuditEntry).not.toHaveBeenCalled();
  });

  test("invalid signature returns 401 and never touches the DB", async () => {
    const res = await post({
      body: { hello: "world" },
      signature: "sha256=deadbeef",
      delivery: "d1",
      event: "ping",
    });
    expect(res.status).toBe(401);
    expect(mockRecordDelivery).not.toHaveBeenCalled();
  });

  test("missing secret env var returns 401", async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const body = JSON.stringify({ a: 1 });
    const res = await post({
      body,
      signature: "sha256=anything",
      delivery: "d1",
      event: "ping",
    });
    expect(res.status).toBe(401);
    expect(mockRecordDelivery).not.toHaveBeenCalled();
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  });
});

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

describe("delivery dedupe", () => {
  test("duplicate delivery returns 200 and skips dispatch", async () => {
    mockRecordDelivery.mockImplementationOnce(() => Promise.resolve(false));
    const body = JSON.stringify({ action: "deleted", installation: { id: 99 } });
    const res = await post({
      body,
      signature: await sign(body),
      delivery: "dup-1",
      event: "installation",
    });
    expect(res.status).toBe(200);
    expect(mockRecordDelivery).toHaveBeenCalledTimes(1);
    expect(mockSuspendInstallationByGithubId).not.toHaveBeenCalled();
    expect(mockInsertAuditEntry).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// installation.deleted
// ---------------------------------------------------------------------------

describe("installation.deleted", () => {
  test("suspends every install row and audits each", async () => {
    mockSuspendInstallationByGithubId.mockImplementationOnce(() =>
      Promise.resolve([
        { id: "ri-1", organizationId: "org-1", suspendedAt: "2026-04-25T00:00:00Z" },
        { id: "ri-2", organizationId: "org-1", suspendedAt: "2026-04-25T00:00:00Z" },
      ])
    );
    const body = JSON.stringify({ action: "deleted", installation: { id: 42 } });
    const res = await post({
      body,
      signature: await sign(body),
      delivery: "d-del",
      event: "installation",
    });
    expect(res.status).toBe(200);
    expect(mockSuspendInstallationByGithubId).toHaveBeenCalledWith(sql, 42);
    expect(mockInsertAuditEntry).toHaveBeenCalledTimes(2);
    const entry = mockInsertAuditEntry.mock.calls[0][1];
    expect(entry).toMatchObject({
      actor: "github-webhook",
      action: "github.install.deleted",
      policyVersion: "v1-test",
      details: { githubInstallId: 42 },
    });
    // Per spec: repo_installation_id null on the install-level audit entry.
    expect(entry.repoInstallationId ?? null).toBeNull();
  });

  test("non-deleted installation actions are acked but not processed", async () => {
    const body = JSON.stringify({ action: "created", installation: { id: 42 } });
    const res = await post({
      body,
      signature: await sign(body),
      delivery: "d-cre",
      event: "installation",
    });
    expect(res.status).toBe(200);
    expect(mockSuspendInstallationByGithubId).not.toHaveBeenCalled();
    expect(mockInsertAuditEntry).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// installation_repositories.removed
// ---------------------------------------------------------------------------

describe("installation_repositories.removed", () => {
  test("suspends only the listed repos for that install and audits each", async () => {
    mockSuspendRepoInstallationsByGithubIdAndRepos.mockImplementationOnce(() =>
      Promise.resolve([
        { id: "ri-7", organizationId: "org-1", suspendedAt: "2026-04-25T00:00:00Z" },
      ])
    );
    const body = JSON.stringify({
      action: "removed",
      installation: { id: 42 },
      repositories_removed: [
        { full_name: "acme/widgets" },
        { full_name: "acme/gadgets" },
      ],
    });
    const res = await post({
      body,
      signature: await sign(body),
      delivery: "d-rm",
      event: "installation_repositories",
    });
    expect(res.status).toBe(200);
    expect(mockSuspendRepoInstallationsByGithubIdAndRepos).toHaveBeenCalledWith(sql, 42, [
      { owner: "acme", repo: "widgets" },
      { owner: "acme", repo: "gadgets" },
    ]);
    expect(mockInsertAuditEntry).toHaveBeenCalledTimes(1);
    expect(mockInsertAuditEntry.mock.calls[0][1]).toMatchObject({
      actor: "github-webhook",
      action: "github.install.repo_removed",
      policyVersion: "v1-test",
      repoInstallationId: "ri-7",
      details: { githubInstallId: 42 },
    });
  });
});

// ---------------------------------------------------------------------------
// Stub events (TODO Task 6.4)
// ---------------------------------------------------------------------------

describe("stub events", () => {
  test("pull_request hits TODO stub but still returns 200", async () => {
    const body = JSON.stringify({ action: "opened", pull_request: { number: 7 } });
    const res = await post({
      body,
      signature: await sign(body),
      delivery: "d-pr",
      event: "pull_request",
    });
    expect(res.status).toBe(200);
    expect(mockSuspendInstallationByGithubId).not.toHaveBeenCalled();
    expect(mockInsertAuditEntry).not.toHaveBeenCalled();
  });

  test("pull_request_review returns 200 without DB writes", async () => {
    const body = JSON.stringify({ action: "submitted", pull_request: { number: 8 } });
    const res = await post({
      body,
      signature: await sign(body),
      delivery: "d-prr",
      event: "pull_request_review",
    });
    expect(res.status).toBe(200);
    expect(mockInsertAuditEntry).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Unknown events + dispatch errors
// ---------------------------------------------------------------------------

describe("unknown events and error paths", () => {
  test("unknown event type returns 200 without writes", async () => {
    const body = JSON.stringify({ action: "anything" });
    const res = await post({
      body,
      signature: await sign(body),
      delivery: "d-unk",
      event: "deployment_status",
    });
    expect(res.status).toBe(200);
    expect(mockInsertAuditEntry).not.toHaveBeenCalled();
  });

  test("dispatch error inside handler still returns 200", async () => {
    mockSuspendInstallationByGithubId.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const body = JSON.stringify({ action: "deleted", installation: { id: 42 } });
    const res = await post({
      body,
      signature: await sign(body),
      delivery: "d-err",
      event: "installation",
    });
    expect(res.status).toBe(200);
  });
});

// best-effort env restore
if (ORIGINAL_SECRET === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
else process.env.GITHUB_WEBHOOK_SECRET = ORIGINAL_SECRET;
