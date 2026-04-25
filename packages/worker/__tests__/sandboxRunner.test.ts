/**
 * Tests for `runSandbox` (Task 5.2).
 *
 * Two modes:
 *   - Default: 6 unit tests with a mocked `spawn` that asserts the runtime
 *     contract args, stdin payload (with token redaction), stdout parse
 *     success/failure, timeout behaviour, env vars (proxy + ANTHROPIC_API_KEY).
 *   - `RUN_SANDBOX_INTEGRATION=1`: 1 extra integration test runs the real
 *     sandbox image against `octocat/Hello-World`. Requires Docker + the
 *     egress-proxy network (see docker/worker-sandbox/README.md).
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { randomBytes } from "node:crypto";
import type { SuggestionCandidate } from "@devscope/shared";
import {
  buildAuthenticatedCloneUrl,
  buildCandidatePayload,
  buildDockerRunArgs,
  redactCloneUrl,
  runSandbox,
  type SandboxRunInput,
  type SandboxSpawner,
} from "../src/sandboxRunner";

// ---------------------------------------------------------------------------
// Test helpers — build a representative SandboxRunInput.
// ---------------------------------------------------------------------------

function makeCandidate(): SuggestionCandidate {
  return {
    id: "cand_test_123",
    repoInstallationId: "inst_1",
    kind: "claude_md",
    evidenceRefs: {
      sessionIds: ["sess_1"],
      patternIds: [],
      antiPatternIds: [],
      insightIds: [],
    },
    evidenceScore: 0.7,
    evidenceBreakdown: {} as never,
    summary: "test candidate",
    status: "in_progress",
    priority: 1,
    suppressionKey: "key1",
    createdAt: "2026-04-25T00:00:00Z",
    claimedAt: "2026-04-25T00:00:01Z",
    claimExpiresAt: "2026-04-25T00:10:01Z",
  };
}

function makeInput(overrides: Partial<SandboxRunInput> = {}): SandboxRunInput {
  return {
    candidate: makeCandidate(),
    cloneToken: "ghs_secret_token_xyz",
    cloneUrl: "https://github.com/octocat/Hello-World.git",
    defaultBranch: "master",
    negativeExamples: [],
    conventionProfile: {},
    ...overrides,
  };
}

/**
 * Build a fake ChildProcess that emits `stdoutPayload` on stdout and exits
 * with the given code on next tick. Captures stdin writes for assertions.
 *
 * If `hangUntilKill` is true, the fake never exits on its own — the test
 * relies on `runSandbox`'s timeout to invoke `.kill()`.
 */
interface FakeProcState {
  stdinChunks: Buffer[];
  killed: boolean;
  killSignal: string | null;
}

function makeFakeSpawner(
  stdoutPayload: string,
  opts: { exitCode?: number; stderr?: string; hangUntilKill?: boolean } = {}
): { spawner: SandboxSpawner; state: FakeProcState; lastArgs: () => string[] } {
  const state: FakeProcState = { stdinChunks: [], killed: false, killSignal: null };
  let capturedArgs: string[] = [];

  const spawner: SandboxSpawner = (_cmd, args) => {
    capturedArgs = args;
    const proc = new EventEmitter() as ChildProcess;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    (proc as unknown as { stdout: PassThrough }).stdout = stdout;
    (proc as unknown as { stderr: PassThrough }).stderr = stderr;
    (proc as unknown as { stdin: PassThrough }).stdin = stdin;

    stdin.on("data", (b: Buffer) => state.stdinChunks.push(Buffer.from(b)));

    proc.kill = ((signal?: string) => {
      state.killed = true;
      state.killSignal = signal ?? "SIGTERM";
      // Simulate the docker CLI dying on signal.
      setImmediate(() => {
        stdout.end();
        stderr.end();
        proc.emit("close", null);
      });
      return true;
    }) as ChildProcess["kill"];

    if (!opts.hangUntilKill) {
      // Emit stdout + stderr then close on next tick, mirroring real spawn.
      setImmediate(() => {
        if (stdoutPayload) stdout.write(stdoutPayload);
        if (opts.stderr) stderr.write(opts.stderr);
        stdout.end();
        stderr.end();
        proc.emit("close", opts.exitCode ?? 0);
      });
    }
    return proc;
  };

  return { spawner, state, lastArgs: () => capturedArgs };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("redactCloneUrl", () => {
  test("redacts the token segment", () => {
    const url = "https://x-access-token:ghs_topsecret@github.com/o/r.git";
    expect(redactCloneUrl(url)).toBe("https://x-access-token:***@github.com/o/r.git");
  });
  test("leaves a token-less URL untouched", () => {
    const url = "https://github.com/o/r.git";
    expect(redactCloneUrl(url)).toBe(url);
  });
});

describe("buildAuthenticatedCloneUrl", () => {
  test("splices x-access-token credentials into the URL", () => {
    const out = buildAuthenticatedCloneUrl(
      "https://github.com/o/r.git",
      "ghs_abc"
    );
    expect(out).toBe("https://x-access-token:ghs_abc@github.com/o/r.git");
  });
});

describe("buildCandidatePayload", () => {
  test("emits the field names entrypoint.sh expects, with token baked in", () => {
    const payload = buildCandidatePayload(makeInput());
    expect(payload.id).toBe("cand_test_123");
    expect(payload.kind).toBe("claude_md");
    expect(payload.repo_default_branch).toBe("master");
    expect(payload.repo_clone_url).toBe(
      "https://x-access-token:ghs_secret_token_xyz@github.com/octocat/Hello-World.git"
    );
    expect(payload.evidence_refs).toBeDefined();
    expect(payload.summary).toBe("test candidate");
    expect(payload.negative_examples).toEqual([]);
    expect(payload.convention_profile).toEqual({});
  });
});

describe("buildDockerRunArgs", () => {
  test("emits the runtime-contract flags from docker/worker-sandbox/README.md", () => {
    const args = buildDockerRunArgs(
      "ctr-name",
      "devscope/worker-sandbox:local",
      "devscope-cloud_devscope-egress-allowlist",
      "http://egress-proxy:8888",
      "sk-ant-test"
    );
    // Spot-check every contract-mandated flag.
    expect(args).toContain("--rm");
    expect(args).toContain("-i");
    expect(args).toContain("--read-only");
    expect(args).toContain("--cap-drop=ALL");
    expect(args).toContain("--memory=2g");
    expect(args).toContain("--pids-limit=256");
    expect(args).toContain("--user");
    expect(args).toContain("1000:1000");
    expect(args).toContain("/work:rw,size=512m,uid=1000");
    expect(args).toContain("/tmp:rw,size=128m,uid=1000");
    expect(args).toContain("devscope-cloud_devscope-egress-allowlist");
    // Env vars
    expect(args).toContain("HTTPS_PROXY=http://egress-proxy:8888");
    expect(args).toContain("HTTP_PROXY=http://egress-proxy:8888");
    expect(args).toContain("NO_PROXY=localhost,127.0.0.1");
    expect(args).toContain("ANTHROPIC_API_KEY=sk-ant-test");
    // Image is the final positional arg.
    expect(args[args.length - 1]).toBe("devscope/worker-sandbox:local");
  });
});

// ---------------------------------------------------------------------------
// runSandbox unit tests
// ---------------------------------------------------------------------------

describe("runSandbox (mocked spawn)", () => {
  test("invokes docker with the runtime-contract args and image", async () => {
    const stdout = JSON.stringify({
      status: "completed",
      candidate_id: "cand_test_123",
      kind: "claude_md",
      draft: { patch: "", files_changed: [], title: "t", body: "b", model: "stub" },
      verification: { verification_results: [] },
    });
    const { spawner, lastArgs } = makeFakeSpawner(stdout);
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const result = await runSandbox(makeInput(), {
      spawner,
      cleanup: () => {},
    });

    expect(result.status).toBe("completed");
    const args = lastArgs();
    expect(args[0]).toBe("run");
    expect(args).toContain("--rm");
    expect(args).toContain("--read-only");
    expect(args).toContain("--cap-drop=ALL");
    expect(args).toContain("devscope-cloud_devscope-egress-allowlist");
    // Container name uses candidate id.
    const nameIdx = args.indexOf("--name");
    expect(nameIdx).toBeGreaterThanOrEqual(0);
    expect(args[nameIdx + 1]).toMatch(/^devscope-sandbox-cand_test_123-/);
    // Image is last positional.
    expect(args[args.length - 1]).toBe("devscope/worker-sandbox:local");
  });

  test("passes proxy + ANTHROPIC_API_KEY via -e flags", async () => {
    const stdout = JSON.stringify({
      status: "completed",
      draft: { patch: "" },
      verification: { verification_results: [] },
    });
    process.env.ANTHROPIC_API_KEY = "sk-ant-key";
    const { spawner, lastArgs } = makeFakeSpawner(stdout);

    await runSandbox(makeInput(), { spawner, cleanup: () => {} });

    expect(lastArgs()).toContain("HTTPS_PROXY=http://egress-proxy:8888");
    expect(lastArgs()).toContain("HTTP_PROXY=http://egress-proxy:8888");
    expect(lastArgs()).toContain("NO_PROXY=localhost,127.0.0.1");
    expect(lastArgs()).toContain("ANTHROPIC_API_KEY=sk-ant-key");
  });

  test("writes the candidate JSON (with authed clone URL) to stdin", async () => {
    const stdout = JSON.stringify({
      status: "completed",
      draft: { patch: "" },
      verification: { verification_results: [] },
    });
    const { spawner, state } = makeFakeSpawner(stdout);

    await runSandbox(makeInput(), { spawner, cleanup: () => {} });

    const stdin = Buffer.concat(state.stdinChunks).toString("utf8");
    const parsed = JSON.parse(stdin);
    expect(parsed.id).toBe("cand_test_123");
    expect(parsed.repo_clone_url).toBe(
      "https://x-access-token:ghs_secret_token_xyz@github.com/octocat/Hello-World.git"
    );
  });

  test("does NOT log the raw token in any log call", async () => {
    const stdout = JSON.stringify({
      status: "completed",
      draft: { patch: "" },
      verification: { verification_results: [] },
    });
    const { spawner } = makeFakeSpawner(stdout);
    const logged: string[] = [];

    await runSandbox(makeInput(), {
      spawner,
      cleanup: () => {},
      log: (msg, fields) =>
        logged.push(`${msg} ${JSON.stringify(fields ?? {})}`),
    });

    const all = logged.join("\n");
    expect(all).not.toContain("ghs_secret_token_xyz");
    // Redacted form should appear in the start log.
    expect(all).toContain("https://x-access-token:***@github.com/octocat/Hello-World.git");
  });

  test("returns failed artifact when stdout is not valid JSON", async () => {
    const { spawner } = makeFakeSpawner("this is not json at all");

    const result = await runSandbox(makeInput(), {
      spawner,
      cleanup: () => {},
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/not valid JSON/i);
    expect(result.verificationResults).toEqual([]);
  });

  test("returns failed artifact (reason='sandbox timeout') and kills the proc when timer fires", async () => {
    const { spawner, state } = makeFakeSpawner("", { hangUntilKill: true });

    const result = await runSandbox(makeInput(), {
      spawner,
      cleanup: () => {},
      timeoutMs: 50,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("sandbox timeout");
    expect(state.killed).toBe(true);
    expect(state.killSignal).toBe("SIGKILL");
  });
});

// ---------------------------------------------------------------------------
// Real-docker integration test (opt-in).
// ---------------------------------------------------------------------------

const RUN_INT = process.env.RUN_SANDBOX_INTEGRATION === "1";
const intTest = RUN_INT ? test : test.skip;

let intPreflight = { ok: true, reason: "" };
beforeAll(() => {
  if (!RUN_INT) return;
  const img = spawnSync("docker", [
    "image",
    "inspect",
    "devscope/worker-sandbox:local",
  ]);
  if (img.status !== 0) {
    intPreflight = { ok: false, reason: "sandbox image not built" };
    return;
  }
  const net = spawnSync("docker", [
    "network",
    "inspect",
    "devscope-cloud_devscope-egress-allowlist",
  ]);
  if (net.status !== 0) {
    intPreflight = { ok: false, reason: "egress-allowlist network missing" };
  }
});

afterEach(() => {
  // Best-effort sweep of any sandbox containers our runs might have left.
  spawnSync("sh", [
    "-c",
    "docker ps -aq --filter name=devscope-sandbox- | xargs -r docker rm -f >/dev/null 2>&1 || true",
  ]);
});

intTest(
  "integration: real sandbox completes against octocat/Hello-World",
  async () => {
    if (!intPreflight.ok) throw new Error(intPreflight.reason);

    const input = makeInput({
      candidate: { ...makeCandidate(), id: `cand_int_${randomBytes(3).toString("hex")}` },
      cloneToken: "unused-public-repo",
      cloneUrl: "https://github.com/octocat/Hello-World.git",
      defaultBranch: "master",
    });
    const result = await runSandbox(input);

    // The agent stub returns an empty patch; that's fine — what matters is
    // we got a structured `completed` artifact with verification results.
    expect(result.status).toBe("completed");
    expect(Array.isArray(result.verificationResults)).toBe(true);
    expect(typeof result.patch).toBe("string");
  },
  120_000
);
