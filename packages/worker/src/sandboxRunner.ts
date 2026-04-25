import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import type {
  ConventionProfile,
  RubricScores,
  SuggestionCandidate,
  VerificationResult,
} from "@devscope/shared";

/**
 * Inputs to `runSandbox` — everything the entrypoint needs to clone the
 * repo and run the agent + verifier pipeline. The caller (worker main loop)
 * is responsible for assembling these from `repo_installations`,
 * `installation_tokens`, and `suppression_ledger`.
 */
export interface SandboxRunInput {
  candidate: SuggestionCandidate;
  /** Plaintext installation access token. NEVER log this. */
  cloneToken: string;
  /** Public clone URL, e.g. `https://github.com/owner/repo.git`. */
  cloneUrl: string;
  defaultBranch: string;
  /** Negative-example bank from suppression_ledger for this (repo, kind). */
  negativeExamples: Array<{ rejectionReason: string; rejectedAt: string }>;
  /** Repo conventions; will be `{}` until Task 6.1 populates `convention_profile`. */
  conventionProfile: ConventionProfile;
}

/**
 * What `runSandbox` returns. The sandbox emits a single JSON object on stdout;
 * we adapt it into this shape. `runSandbox` NEVER rejects — every failure mode
 * (timeout, exec failure, parse failure, container error) becomes
 * `status: 'failed'` with a human-readable `reason`.
 */
export interface SandboxArtifact {
  status: "completed" | "failed";
  /** Set when `status === 'failed'`. */
  reason?: string;
  /** Unified diff (when `status === 'completed'`). */
  patch?: string;
  filesChanged?: string[];
  title?: string;
  body?: string;
  model?: string;
  verificationResults: VerificationResult[];
  /** `null` until Task 5.5 lands the rubric scorer. */
  rubricScores?: RubricScores | null;
}

// ---------------------------------------------------------------------------
// Configuration constants — defaulted, overridable via env.
// ---------------------------------------------------------------------------

const DEFAULT_IMAGE = "devscope/worker-sandbox:local";
const DEFAULT_NETWORK = "devscope-cloud_devscope-egress-allowlist";
const DEFAULT_PROXY_URL = "http://egress-proxy:8888";
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes hard kill

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Replace the `x-access-token:<token>` portion of a clone URL with `***`.
 * Used in any log line that mentions the URL — the raw URL must NEVER appear.
 */
export function redactCloneUrl(urlWithToken: string): string {
  return urlWithToken.replace(
    /https:\/\/x-access-token:[^@]+@/,
    "https://x-access-token:***@"
  );
}

/**
 * Bake an installation access token into a GitHub clone URL using GitHub's
 * documented `x-access-token` user pattern. `git` honours this without any
 * credential helper config.
 */
export function buildAuthenticatedCloneUrl(cloneUrl: string, token: string): string {
  return cloneUrl.replace(/^https:\/\//, `https://x-access-token:${token}@`);
}

/**
 * Assemble the JSON payload sent to the sandbox entrypoint on stdin.
 * Field names match what `entrypoint.sh` reads via `jq`.
 */
export function buildCandidatePayload(input: SandboxRunInput): Record<string, unknown> {
  const authedUrl = buildAuthenticatedCloneUrl(input.cloneUrl, input.cloneToken);
  return {
    id: input.candidate.id,
    kind: input.candidate.kind,
    repo_clone_url: authedUrl,
    repo_default_branch: input.defaultBranch,
    evidence_refs: input.candidate.evidenceRefs,
    summary: input.candidate.summary,
    negative_examples: input.negativeExamples,
    convention_profile: input.conventionProfile,
  };
}

/**
 * Translate the sandbox's stdout JSON into a `SandboxArtifact`. Tolerates
 * both the documented success shape and the documented failure shape;
 * anything else collapses to a `status: 'failed'` parse error.
 */
function parseSandboxOutput(raw: string): SandboxArtifact {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      status: "failed",
      reason: "sandbox produced no stdout",
      verificationResults: [],
    };
  }
  // Entrypoint's last non-empty line is the artifact JSON.
  const lastLine = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()!;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(lastLine);
  } catch (err) {
    return {
      status: "failed",
      reason: `sandbox stdout was not valid JSON: ${(err as Error).message}`,
      verificationResults: [],
    };
  }

  if (parsed.status === "failed") {
    return {
      status: "failed",
      reason: typeof parsed.reason === "string" ? parsed.reason : "sandbox failed",
      verificationResults: [],
    };
  }
  if (parsed.status !== "completed") {
    return {
      status: "failed",
      reason: `sandbox returned unexpected status: ${String(parsed.status)}`,
      verificationResults: [],
    };
  }

  const draft = (parsed.draft ?? {}) as Record<string, unknown>;
  const verification = (parsed.verification ?? {}) as Record<string, unknown>;
  // entrypoint emits verification.verification_results; tolerate `.results` too.
  const vResults =
    (verification.verification_results as unknown) ??
    (verification.results as unknown);
  const verificationResults = Array.isArray(vResults)
    ? (vResults as VerificationResult[])
    : [];

  return {
    status: "completed",
    patch: typeof draft.patch === "string" ? draft.patch : "",
    filesChanged: Array.isArray(draft.files_changed)
      ? (draft.files_changed as string[])
      : [],
    title: typeof draft.title === "string" ? draft.title : "",
    body: typeof draft.body === "string" ? draft.body : "",
    model: typeof draft.model === "string" ? draft.model : "",
    verificationResults,
    rubricScores: null,
  };
}

// ---------------------------------------------------------------------------
// runSandbox
// ---------------------------------------------------------------------------

/** Build the `docker run` argv that enforces the runtime contract. */
export function buildDockerRunArgs(
  containerName: string,
  image: string,
  network: string,
  proxyUrl: string,
  anthropicKey: string
): string[] {
  return [
    "run",
    "--rm",
    "-i",
    "--name",
    containerName,
    "--network",
    network,
    "--read-only",
    "--tmpfs",
    "/work:rw,size=512m,uid=1000",
    "--tmpfs",
    "/tmp:rw,size=128m,uid=1000",
    "--user",
    "1000:1000",
    "--cap-drop=ALL",
    "--memory=2g",
    "--pids-limit=256",
    "-e",
    `HTTPS_PROXY=${proxyUrl}`,
    "-e",
    `HTTP_PROXY=${proxyUrl}`,
    "-e",
    "NO_PROXY=localhost,127.0.0.1",
    "-e",
    `ANTHROPIC_API_KEY=${anthropicKey}`,
    image,
  ];
}

/** Injectable spawner — the unit tests substitute a fake. */
export type SandboxSpawner = (
  command: string,
  args: string[]
) => ChildProcess;

export interface SandboxDeps {
  spawner?: SandboxSpawner;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
  /** Override timeout (test only). */
  timeoutMs?: number;
  /** Defensive cleanup hook — invoked in `finally`. Swallows errors. */
  cleanup?: (containerName: string) => void;
}

/**
 * Spawn the sandbox container for one candidate, send it the candidate JSON
 * on stdin, collect the artifact JSON on stdout, and resolve with a
 * `SandboxArtifact`. NEVER rejects — failures (timeout, parse error,
 * docker error) come back as `status: 'failed'` values.
 *
 * Implementation note: we shell out to `docker run` via `child_process.spawn`
 * rather than driving the Docker engine API through `dockerode`. Reason:
 * dockerode's stdin attach requires HTTP connection hijack
 * (`req.on('upgrade')`) over the unix socket, which Bun does not implement
 * for unix-socket transports. `docker run` with --rm enforces the same
 * runtime contract documented in `docker/worker-sandbox/README.md`, with
 * stdin/stdout fully controllable via the spawned process's pipes.
 */
export async function runSandbox(
  input: SandboxRunInput,
  deps: SandboxDeps = {}
): Promise<SandboxArtifact> {
  const log = deps.log ?? (() => {});
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const spawner: SandboxSpawner = deps.spawner ?? ((cmd, args) => spawn(cmd, args));

  const image = process.env.SANDBOX_IMAGE ?? DEFAULT_IMAGE;
  const network = process.env.SANDBOX_NETWORK ?? DEFAULT_NETWORK;
  const proxyUrl = process.env.EGRESS_PROXY_URL ?? DEFAULT_PROXY_URL;
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";

  const containerName = `devscope-sandbox-${input.candidate.id}-${randomBytes(3).toString("hex")}`;
  const payload = buildCandidatePayload(input);
  const stdinJson = JSON.stringify(payload);
  const args = buildDockerRunArgs(containerName, image, network, proxyUrl, anthropicKey);

  log("sandbox starting", {
    candidateId: input.candidate.id,
    image,
    network,
    cloneUrl: redactCloneUrl(payload.repo_clone_url as string),
    containerName,
  });

  let proc: ChildProcess | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  let timedOut = false;

  try {
    proc = spawner("docker", args);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout?.on("data", (b: Buffer) => stdoutChunks.push(Buffer.from(b)));
    proc.stderr?.on("data", (b: Buffer) => stderrChunks.push(Buffer.from(b)));

    // Hard timeout: SIGKILL on expiry. Cleared on normal exit.
    killTimer = setTimeout(() => {
      timedOut = true;
      // Kill the docker CLI process; also `docker rm -f` the container in
      // finally to make sure it doesn't outlive us.
      proc?.kill("SIGKILL");
    }, timeoutMs);

    // Pipe candidate JSON to stdin and close (StdinOnce semantics).
    proc.stdin?.end(stdinJson);

    // Wait for the docker CLI process to exit. spawn() resolves on 'close'
    // (after stdio streams flush), giving us full stdout.
    const exitCode: number | null = await new Promise((resolve) => {
      proc!.on("close", (code) => resolve(code));
      proc!.on("error", () => resolve(-1));
    });

    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = undefined;
    }

    if (timedOut) {
      log("sandbox timeout", { candidateId: input.candidate.id, timeoutMs });
      return {
        status: "failed",
        reason: "sandbox timeout",
        verificationResults: [],
      };
    }

    const stdout = Buffer.concat(stdoutChunks).toString("utf8");
    const stderr = Buffer.concat(stderrChunks).toString("utf8");

    if (exitCode !== 0) {
      // Entrypoint always exits 0 with structured JSON — a non-zero exit is
      // a docker-CLI-level failure (image missing, network missing, etc.).
      // Stderr is short (docker's own error message); safe to surface.
      return {
        status: "failed",
        reason: `docker exit ${exitCode}: ${stderr.trim().slice(0, 200)}`,
        verificationResults: [],
      };
    }

    const artifact = parseSandboxOutput(stdout);

    log("sandbox finished", {
      candidateId: input.candidate.id,
      status: artifact.status,
      stderrBytes: stderr.length,
    });

    return artifact;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log("sandbox error", { candidateId: input.candidate.id, err: reason });
    return {
      status: "failed",
      reason: `sandbox exec failed: ${reason}`,
      verificationResults: [],
    };
  } finally {
    if (killTimer) clearTimeout(killTimer);
    // --rm handles the happy path. Defensive `docker rm -f` for
    // crashes/timeouts where the container may have outlived our CLI proc.
    if (deps.cleanup) {
      try {
        deps.cleanup(containerName);
      } catch {
        /* never throw from finally */
      }
    } else {
      try {
        spawn("docker", ["rm", "-f", containerName], { stdio: "ignore" });
      } catch {
        /* best effort */
      }
    }
  }
}
