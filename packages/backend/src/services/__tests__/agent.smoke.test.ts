/**
 * End-to-end agent integration test (Task 5.3).
 *
 * Spins up the sandbox image with a real candidate JSON, an injected
 * ANTHROPIC_API_KEY, and the egress-proxy network. Asserts the container
 * exits cleanly and emits a structured draft JSON — empty patch IS
 * acceptable (the model may decide nothing's worth changing for the
 * fixture repo). Token counts must be > 0 to confirm the API was hit.
 *
 * Opt-in via `RUN_AGENT_INTEGRATION=1` AND `ANTHROPIC_API_KEY`.
 *
 * Prerequisites (mirror sandbox.smoke.test.ts):
 *   1. `devscope/worker-sandbox:local` image is built.
 *   2. `egress-proxy` running on `devscope-cloud_devscope-egress-allowlist`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const ENABLED =
    process.env.RUN_AGENT_INTEGRATION === "1" &&
    !!process.env.ANTHROPIC_API_KEY;
const skipIf = (cond: boolean) => (cond ? test.skip : test);

const IMAGE = "devscope/worker-sandbox:local";
const NETWORK = "devscope-cloud_devscope-egress-allowlist";
const PROXY = "http://egress-proxy:8888";

const spawnedNames: string[] = [];
afterEach(() => {
    for (const n of spawnedNames.splice(0)) {
        spawnSync("docker", ["rm", "-f", n], { stdio: "ignore", timeout: 10_000 });
    }
});

describe("agent end-to-end smoke", () => {
    skipIf(!ENABLED)(
        "produces a structured draft from a real Anthropic call",
        () => {
            const name = `devscope-agent-it-${randomBytes(4).toString("hex")}`;
            spawnedNames.push(name);
            const candidate = {
                id: `cand_it_${randomBytes(3).toString("hex")}`,
                kind: "claude_md",
                repo_clone_url: "https://github.com/octocat/Hello-World.git",
                repo_default_branch: "master",
                evidenceRefs: {
                    sessionIds: ["sess_it_001"],
                    patternIds: [],
                    antiPatternIds: ["ap_it_x"],
                    insightIds: [],
                },
                evidenceSummary:
                    "Repeated confusion finding the test command — 4 sessions in last 7 days.",
                evidenceDetail: {
                    antiPatterns: [
                        {
                            name: "missing_test_command_doc",
                            severity: "medium",
                            suggestion:
                                "Document how to run tests at the top of CLAUDE.md.",
                            sampleErrors: [
                                "no test framework discovered",
                                "could not find package.json",
                            ],
                        },
                    ],
                    patterns: [],
                    sessionExcerpts: [
                        {
                            sessionId: "sess_it_001",
                            toolCall: "Bash(npm test)",
                            error: "npm: command not found",
                            timestamp: "2026-04-20T10:00:00Z",
                        },
                    ],
                },
                conventionProfile: { titleFormat: "plain" },
                negativeExamples: [],
            };
            const args = [
                "run",
                "--rm",
                "-i",
                "--name",
                name,
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
                "--env",
                `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`,
                IMAGE,
            ];
            const result = spawnSync("docker", args, {
                input: JSON.stringify(candidate),
                timeout: 5 * 60 * 1000,
                encoding: "utf8",
            });
            expect(result.status).toBe(0);
            const lastLine = (result.stdout ?? "")
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
                .pop();
            expect(lastLine).toBeDefined();
            const artifact = JSON.parse(lastLine!);
            expect(artifact.status).toBe("completed");
            expect(artifact.draft).toBeDefined();
            expect(artifact.draft.model).toBe("claude-sonnet-4-6");
            // Either the agent produced a real patch or it deliberately emitted
            // an empty one — both are acceptable. What MUST be true is that the
            // API was actually called (non-zero token usage).
            expect(artifact.draft.input_tokens).toBeGreaterThan(0);
            expect(artifact.draft.output_tokens).toBeGreaterThan(0);
            expect(artifact.draft.tool_call_count).toBeGreaterThan(0);
        },
        10 * 60 * 1000
    );
});
