import type { SQL } from "bun";
import type { SuggestionCandidate } from "@devscope/shared";
import { updateCandidateStatus } from "../../backend/src/db/suggestionQueries";
import { getRepoInstallation } from "../../backend/src/db/repoInstallationQueries";
import { listSuppressedRejectionReasonsForRepo } from "../../backend/src/db/suppressionQueries";
import { getInstallationToken } from "../../backend/src/services/githubApp";
import { makePostgresClient } from "./db";
import { claimNextCandidate } from "./claim";
import { revalidate } from "./revalidate";
import { runSandbox, type SandboxArtifact } from "./sandboxRunner";
import { persistArtifact } from "./persistArtifact";
import { buildEvidenceDetail } from "./buildEvidenceDetail";

const NEGATIVE_EXAMPLE_WINDOW_DAYS = 60;

/**
 * Suggestion-worker main loop. Polls `suggestion_candidates`, claims one at a
 * time, revalidates evidence freshness + suppression, runs the candidate
 * through a sandbox container (Task 5.2 stub), and writes the resulting
 * `suggestion_artifacts` row.
 *
 * Disabled by default — set `SUGGESTION_WORKER_ENABLED=true` to enable. When
 * disabled the loop sleeps without claiming so the container can sit idle in
 * compose stacks waiting for a flag flip.
 *
 * Crash recovery is server-side: `claim_expires_at` (10 minute lease) is the
 * only un-claim path. The worker NEVER manually releases a claim.
 */

const POLL_INTERVAL_MS = 5_000;
const SHUTDOWN_GRACE_MS = 30_000;

let shuttingDown = false;

function enabled(): boolean {
  return process.env.SUGGESTION_WORKER_ENABLED === "true";
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg: string, fields?: Record<string, unknown>): void {
  const line = { ts: new Date().toISOString(), level: "info", msg, ...fields };
  console.log(JSON.stringify(line));
}

function logError(msg: string, fields?: Record<string, unknown>): void {
  const line = { ts: new Date().toISOString(), level: "error", msg, ...fields };
  console.error(JSON.stringify(line));
}

/**
 * Process exactly one candidate. Returns `false` when nothing was claimed
 * (caller sleeps before polling again), `true` otherwise.
 */
export async function processOne(sql: SQL): Promise<boolean> {
  const candidate: SuggestionCandidate | null = await claimNextCandidate(sql);
  if (!candidate) return false;

  log("candidate claimed", { candidateId: candidate.id, kind: candidate.kind });

  try {
    const reval = await revalidate(sql, candidate);
    if (!reval.ok) {
      log("candidate revalidation failed", {
        candidateId: candidate.id,
        markStatus: reval.markStatus,
        reason: reval.reason,
      });
      await updateCandidateStatus(sql, candidate.id, reval.markStatus);
      return true;
    }

    // Resolve repo installation + mint a fresh access token so the sandbox
    // can clone. If either step fails, persist a failed artifact rather than
    // leaving the candidate stuck in_progress until the lease expires.
    let artifact: SandboxArtifact;
    const installation = await getRepoInstallation(sql, candidate.repoInstallationId);
    if (!installation) {
      artifact = {
        status: "failed",
        reason: "repo installation missing",
        verificationResults: [],
      };
    } else {
      try {
        const cloneToken = await getInstallationToken(
          sql,
          installation.githubInstallId
        );

        // Resolve evidence detail + negative examples in parallel before
        // launching the sandbox so the agent prompt is fully populated.
        const sinceDate = new Date(
          Date.now() - NEGATIVE_EXAMPLE_WINDOW_DAYS * 24 * 60 * 60 * 1000
        );
        const [evidenceDetail, negativeExamples] = await Promise.all([
          buildEvidenceDetail(sql, candidate.evidenceRefs, { log }),
          listSuppressedRejectionReasonsForRepo(
            sql,
            candidate.repoInstallationId,
            candidate.kind,
            sinceDate
          ),
        ]);

        artifact = await runSandbox({
          candidate,
          cloneToken,
          cloneUrl: `https://github.com/${installation.owner}/${installation.repo}.git`,
          defaultBranch: installation.defaultBranch,
          negativeExamples,
          conventionProfile: installation.conventionProfile,
          evidenceDetail,
        });
      } catch (err) {
        artifact = {
          status: "failed",
          reason: `installation token mint failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          verificationResults: [],
        };
      }
    }
    const persisted = await persistArtifact(sql, candidate.id, artifact);
    // Once an artifact exists the candidate transitions to artifact_ready,
    // regardless of whether the artifact passed or failed verification.
    await updateCandidateStatus(sql, candidate.id, "artifact_ready");
    log("artifact persisted", {
      candidateId: candidate.id,
      artifactId: persisted.id,
      status: persisted.status,
    });
  } catch (err) {
    // No manual un-claim — `claim_expires_at` lease TTL handles retry.
    logError("candidate processing failed", {
      candidateId: candidate.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

export async function main(): Promise<void> {
  const sql = makePostgresClient();
  log("worker started", { enabled: enabled() });

  let lastDisabledLog = 0;
  while (!shuttingDown) {
    if (!enabled()) {
      // Throttle the "disabled" log to once per minute so an idle container
      // doesn't fill stdout.
      const now = Date.now();
      if (now - lastDisabledLog > 60_000) {
        log("worker disabled, sleeping");
        lastDisabledLog = now;
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const claimed = await processOne(sql);
    if (!claimed) await sleep(POLL_INTERVAL_MS);
  }

  log("worker shutdown complete");
}

function installSignalHandlers(): void {
  const handler = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("shutdown signal received", { signal });
    // Hard exit if main loop hasn't returned within the grace window.
    setTimeout(() => {
      logError("graceful shutdown timeout, forcing exit");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
  };
  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));
}

if (import.meta.main) {
  installSignalHandlers();
  main().catch(err => {
    logError("worker crashed", { err: err instanceof Error ? err.stack : String(err) });
    process.exit(1);
  });
}
