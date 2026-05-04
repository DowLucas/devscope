// DevScope verifier.
//
// Reads draft JSON (containing the unified diff in `patch`) on STDIN.
// Reads candidate JSON from $DEVSCOPE_CANDIDATE_PATH (passed by entrypoint.sh)
// to access conventionProfile + evidenceRefs needed by Task 5.4 gates.
// Expects env: DEVSCOPE_KIND, DEVSCOPE_CLONE_PATH.
// Optional env: DEVSCOPE_CANDIDATE_PATH, DEVSCOPE_DEPS_INSTALLED.
// Writes `{verification_results, all_passed}` on STDOUT. All logging on STDERR.

import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import type { Candidate, Draft, VerificationResult } from "./types";
import { filesTouchedByPatch } from "./types";
import { gateEvidenceDereferences } from "./gates/evidenceDereferences";
import { gateConventions } from "./gates/conventions";
import { gateTests } from "./gates/tests";
import { gateLint } from "./gates/lint";

// -----------------------------------------------------------------------------
// Per-kind allowed-path matchers for the kind_scope gate.
// claude_md is the only kind implemented through Task 5.4. Other kinds are
// Epic 9.
// -----------------------------------------------------------------------------
const KIND_PATH_MATCHERS: Partial<Record<string, (path: string) => boolean>> = {
    claude_md: (p) => p === "CLAUDE.md" || p.endsWith("/CLAUDE.md"),
};

// -----------------------------------------------------------------------------
// Mechanical gates (kept inline — small + project-specific).
// -----------------------------------------------------------------------------

function gatePatchApplies(patch: string, clonePath: string): VerificationResult {
    try {
        if (!patch || patch.trim() === "") {
            return { gate: "patch_applies", pass: true, reason: "empty patch (no-op)" };
        }
        const tmp = mkdtempSync(join(tmpdir(), "devscope-patch-"));
        const patchFile = join(tmp, "candidate.patch");
        try {
            writeFileSync(patchFile, patch, "utf8");
            const result = spawnSync("git", ["apply", "--check", patchFile], {
                cwd: clonePath,
                encoding: "utf8",
                timeout: 1000,
            });
            if (result.status === 0) {
                return { gate: "patch_applies", pass: true, reason: "git apply --check ok" };
            }
            const stderr = (result.stderr || "").trim().slice(0, 200);
            return {
                gate: "patch_applies",
                pass: false,
                reason: `git apply --check failed: ${stderr || "exit " + result.status}`,
            };
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    } catch (err) {
        return { gate: "patch_applies", pass: false, reason: `gate error: ${(err as Error).message}` };
    }
}

function gateKindScope(patch: string, kind: string): VerificationResult {
    try {
        const matcher = KIND_PATH_MATCHERS[kind];
        if (!matcher) {
            return {
                gate: "kind_scope",
                pass: false,
                reason: `kind ${kind} not yet supported (Epic 9)`,
            };
        }
        const touched = filesTouchedByPatch(patch);
        if (touched.length === 0) {
            return { gate: "kind_scope", pass: true, reason: "no files touched" };
        }
        const offenders = touched.filter((p) => !matcher(p));
        if (offenders.length === 0) {
            return {
                gate: "kind_scope",
                pass: true,
                reason: `all ${touched.length} touched file(s) within kind scope`,
            };
        }
        return {
            gate: "kind_scope",
            pass: false,
            reason: `kind=${kind} disallows: ${offenders.slice(0, 3).join(", ")}`,
        };
    } catch (err) {
        return { gate: "kind_scope", pass: false, reason: `gate error: ${(err as Error).message}` };
    }
}

// -----------------------------------------------------------------------------
// Main.
// -----------------------------------------------------------------------------

function loadCandidate(): Candidate | undefined {
    const path = process.env.DEVSCOPE_CANDIDATE_PATH;
    if (!path) return undefined;
    if (!existsSync(path)) return undefined;
    try {
        return JSON.parse(readFileSync(path, "utf8")) as Candidate;
    } catch (err) {
        process.stderr.write(`verifier: failed to read candidate: ${(err as Error).message}\n`);
        return undefined;
    }
}

export async function main(): Promise<void> {
    const kind = process.env.DEVSCOPE_KIND;
    const clonePath = process.env.DEVSCOPE_CLONE_PATH;
    if (!kind) throw new Error("DEVSCOPE_KIND env var is required");
    if (!clonePath) throw new Error("DEVSCOPE_CLONE_PATH env var is required");

    const raw = await Bun.stdin.text();
    const draft = JSON.parse(raw) as Draft;
    const patch = draft.patch ?? "";
    const title = draft.title ?? "";
    const body = draft.body ?? "";

    const candidate = loadCandidate();
    const conventionProfile =
        candidate?.conventionProfile ?? candidate?.convention_profile;

    const verification_results: VerificationResult[] = [
        gatePatchApplies(patch, clonePath),
        gateEvidenceDereferences(body, candidate ?? ({ id: "", kind } as Candidate)),
        gateKindScope(patch, kind),
        gateTests(patch, clonePath),
        gateLint(patch, clonePath),
        gateConventions(title, body, conventionProfile),
    ];

    const all_passed = verification_results.every((r) => r.pass);
    process.stdout.write(JSON.stringify({ verification_results, all_passed }));
}

// Only run main when invoked as a script, not when imported by tests.
if (import.meta.main) {
    await main();
}
