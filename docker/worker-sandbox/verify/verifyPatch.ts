// DevScope verifier — SKELETON.
//
// Task 5.4 will fill in the four TODO gates (evidence_dereferences, tests,
// lint, conventions). For Task 3.1 only the two pure mechanical gates are
// real: `patch_applies` and `kind_scope`.
//
// Reads draft JSON (containing the unified diff in `patch`) on STDIN.
// Expects env: DEVSCOPE_KIND, DEVSCOPE_CLONE_PATH.
// Writes `{verification_results, all_passed}` on STDOUT.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// -----------------------------------------------------------------------------
// Local mirror of `VerificationResult` from packages/shared/src/github.ts.
// MUST stay in sync with the shared type — the sandbox image is built from a
// separate Docker context and intentionally has no access to @devscope/shared.
// -----------------------------------------------------------------------------
type Gate =
    | "patch_applies"
    | "evidence_dereferences"
    | "kind_scope"
    | "tests"
    | "lint"
    | "conventions";

interface VerificationResult {
    gate: Gate;
    pass: boolean;
    reason: string;
}

interface Draft {
    patch: string;
    title?: string;
    body?: string;
    model?: string;
    files_changed?: string[];
}

// -----------------------------------------------------------------------------
// Per-kind allowed-path matchers for the kind_scope gate.
// claude_md is the only kind implemented in Task 3.1.
// -----------------------------------------------------------------------------
const KIND_PATH_MATCHERS: Partial<Record<string, (path: string) => boolean>> = {
    // Any CLAUDE.md anywhere in the tree (root or nested).
    claude_md: (p) => p === "CLAUDE.md" || p.endsWith("/CLAUDE.md"),
};

// -----------------------------------------------------------------------------
// Gate implementations.
// -----------------------------------------------------------------------------

function gatePatchApplies(patch: string, clonePath: string): VerificationResult {
    if (!patch || patch.trim() === "") {
        // Empty patch is trivially appliable (no-op). Treat as pass so the
        // stub agent's empty draft can flow through Task 3.1's smoke test.
        return { gate: "patch_applies", pass: true, reason: "empty patch (no-op)" };
    }
    const tmp = mkdtempSync(join(tmpdir(), "devscope-patch-"));
    const patchFile = join(tmp, "candidate.patch");
    try {
        writeFileSync(patchFile, patch, "utf8");
        // spawnSync with execFile semantics — argv array, no shell.
        const result = spawnSync("git", ["apply", "--check", patchFile], {
            cwd: clonePath,
            encoding: "utf8",
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
}

/**
 * Parse a unified diff and return the set of file paths it touches.
 * Looks at `diff --git a/<x> b/<y>` headers. Uses the `b/` (post) path
 * since that is what the patch creates/modifies; for deletions a/ == b/.
 */
function filesTouchedByPatch(patch: string): string[] {
    const files = new Set<string>();
    const re = /^diff --git a\/(\S+) b\/(\S+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(patch)) !== null) {
        files.add(m[2]);
    }
    return [...files];
}

function gateKindScope(patch: string, kind: string): VerificationResult {
    const matcher = KIND_PATH_MATCHERS[kind];
    if (!matcher) {
        // The kinds skill, hook, command, agent, config, remove are out of
        // scope for Task 3.1. Task 5.4 will implement them.
        throw new Error(`Task 5.4: kind ${kind} not yet supported`);
    }
    const touched = filesTouchedByPatch(patch);
    if (touched.length === 0) {
        // Empty patch — no scope violation possible.
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
}

// Explicit stubs for the four gates Task 5.4 will implement.
function gateEvidenceDereferences(): VerificationResult {
    return { gate: "evidence_dereferences", pass: true, reason: "TODO Task 5.4" };
}
function gateTests(): VerificationResult {
    return { gate: "tests", pass: true, reason: "TODO Task 5.4" };
}
function gateLint(): VerificationResult {
    return { gate: "lint", pass: true, reason: "TODO Task 5.4" };
}
function gateConventions(): VerificationResult {
    return { gate: "conventions", pass: true, reason: "TODO Task 5.4" };
}

// -----------------------------------------------------------------------------
// Main.
// -----------------------------------------------------------------------------

const kind = process.env.DEVSCOPE_KIND;
const clonePath = process.env.DEVSCOPE_CLONE_PATH;
if (!kind) throw new Error("DEVSCOPE_KIND env var is required");
if (!clonePath) throw new Error("DEVSCOPE_CLONE_PATH env var is required");

const raw = await Bun.stdin.text();
const draft = JSON.parse(raw) as Draft;
const patch = draft.patch ?? "";

const verification_results: VerificationResult[] = [
    gatePatchApplies(patch, clonePath),
    gateEvidenceDereferences(),
    gateKindScope(patch, kind),
    gateTests(),
    gateLint(),
    gateConventions(),
];

const all_passed = verification_results.every((r) => r.pass);
process.stdout.write(JSON.stringify({ verification_results, all_passed }));
