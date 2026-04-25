/**
 * GitHub App webhook receiver.
 *
 * Single endpoint POST /api/github/webhook. Order of operations is strict:
 *
 *   1. HMAC-SHA256 verify against `X-Hub-Signature-256` using
 *      GITHUB_WEBHOOK_SECRET. Failure → 401 with no DB access.
 *   2. Dedupe by `X-GitHub-Delivery` via `recordDelivery`. Duplicate → 200,
 *      no further processing.
 *   3. Dispatch on `X-GitHub-Event`. Known events update DB + write audit;
 *      stub events log a TODO; unknown events are ack'd. ALL paths return 200
 *      so GitHub does not retry — internal failures are logged, not surfaced.
 */

import { Hono } from "hono";
import type { SQL } from "bun";
import {
  suspendInstallationByGithubId,
  suspendRepoInstallationsByGithubIdAndRepos,
} from "../db/repoInstallationQueries";
import { recordDelivery } from "../db/webhookDeliveryQueries";
import { insertAuditEntry } from "../db/auditLogQueries";
import { POLICY_VERSION } from "../services/githubApp";

/**
 * Constant-time HMAC-SHA256 comparison of the signature header against the
 * raw request body. `header` is the full `sha256=<hex>` value.
 */
async function verifySignature(
  rawBody: string,
  header: string | undefined,
  secret: string
): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const provided = header.slice("sha256=".length);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Buffer.from(sig).toString("hex");

  // Constant-time compare. Bail early on length mismatch (still safe — leaking
  // length is fine for a fixed-size hex digest).
  if (expected.length !== provided.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return mismatch === 0;
}

export function githubWebhookRoutes(sql: SQL) {
  const app = new Hono();

  app.post("/", async (c) => {
    // 1. Signature verification — first thing, no DB access before this passes.
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      console.warn("[githubWebhook] GITHUB_WEBHOOK_SECRET not set; rejecting all webhooks");
      return c.body(null, 401);
    }

    const sigHeader = c.req.header("x-hub-signature-256");
    // Read raw body (bytes) — c.req.json() would consume the stream and we
    // need the exact bytes for HMAC.
    const rawBody = await c.req.raw.text();

    const ok = await verifySignature(rawBody, sigHeader, secret);
    if (!ok) {
      console.warn("[githubWebhook] signature mismatch or missing");
      return c.body(null, 401);
    }

    // 2. Dedupe.
    const deliveryId = c.req.header("x-github-delivery");
    const event = c.req.header("x-github-event") ?? "";
    if (!deliveryId) {
      console.warn("[githubWebhook] missing X-GitHub-Delivery header");
      return c.body(null, 400);
    }

    const fresh = await recordDelivery(sql, deliveryId, event);
    if (!fresh) {
      // Duplicate redelivery — GitHub already got our 200 once. Acknowledge
      // again with no side effects.
      return c.body(null, 200);
    }

    // 3. Parse + dispatch. Wrap in try/catch — we always 200 so GitHub stops
    // retrying; failures are our problem to investigate via logs.
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch (err) {
      console.error("[githubWebhook] invalid JSON body", { deliveryId, event, err });
      return c.body(null, 200);
    }

    const action = payload?.action;

    try {
      switch (event) {
        case "pull_request": {
          const prNumber = payload?.pull_request?.number;
          console.log("TODO Task 6.4: pull_request", { action, pr_number: prNumber });
          break;
        }
        case "pull_request_review": {
          const prNumber = payload?.pull_request?.number;
          console.log("TODO Task 6.4: pull_request_review", { action, pr_number: prNumber });
          break;
        }
        case "installation": {
          if (action === "deleted") {
            const githubInstallId = Number(payload?.installation?.id);
            if (!Number.isFinite(githubInstallId)) {
              console.warn("[githubWebhook] installation.deleted: missing installation.id", {
                deliveryId,
              });
              break;
            }
            const suspended = await suspendInstallationByGithubId(sql, githubInstallId);
            for (const _row of suspended) {
              await insertAuditEntry(sql, {
                actor: "github-webhook",
                action: "github.install.deleted",
                policyVersion: POLICY_VERSION,
                // repo_installation_id intentionally null per task spec — this
                // event covers the entire install, not a single repo.
                details: { githubInstallId },
              });
            }
          } else {
            console.log("webhook unhandled event", event, action);
          }
          break;
        }
        case "installation_repositories": {
          if (action === "removed") {
            const githubInstallId = Number(payload?.installation?.id);
            const removed: Array<{ owner: string; repo: string }> = Array.isArray(
              payload?.repositories_removed
            )
              ? payload.repositories_removed
                  .map((r: { full_name?: string }) => {
                    const fn = r?.full_name ?? "";
                    const slash = fn.indexOf("/");
                    if (slash <= 0) return null;
                    return { owner: fn.slice(0, slash), repo: fn.slice(slash + 1) };
                  })
                  .filter((r: unknown): r is { owner: string; repo: string } => r !== null)
              : [];
            if (!Number.isFinite(githubInstallId) || removed.length === 0) {
              console.warn(
                "[githubWebhook] installation_repositories.removed: nothing to suspend",
                { deliveryId }
              );
              break;
            }
            const suspended = await suspendRepoInstallationsByGithubIdAndRepos(
              sql,
              githubInstallId,
              removed
            );
            for (const row of suspended) {
              await insertAuditEntry(sql, {
                actor: "github-webhook",
                action: "github.install.repo_removed",
                policyVersion: POLICY_VERSION,
                repoInstallationId: row.id,
                details: { githubInstallId },
              });
            }
          } else {
            console.log("webhook unhandled event", event, action);
          }
          break;
        }
        default:
          console.log("webhook unhandled event", event, action);
      }
    } catch (err) {
      // Internal failure — still ack so GitHub doesn't retry forever. Log
      // with full context so we can investigate.
      console.error("[githubWebhook] dispatch error", {
        deliveryId,
        event,
        action,
        err: (err as Error).message,
        stack: (err as Error).stack,
      });
    }

    return c.body(null, 200);
  });

  return app;
}
