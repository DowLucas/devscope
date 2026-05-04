// Gate 4: tests (best-effort).
//
// - Skipped for docs-only patches (CLAUDE.md, /docs/, /documentation/).
// - Skipped if no recognised test runner is declared in package.json.
// - Otherwise: copies the repo to a scratch dir, applies the patch, runs
//   the detected runner with a 3-minute timeout. Pass on exit 0.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VerificationResult } from "../types";
import { filesTouchedByPatch } from "../types";

const TEST_TIMEOUT_MS = 3 * 60 * 1000;

const DOCS_PATH_RE = /^(?:CLAUDE\.md|.*\/CLAUDE\.md|docs\/|documentation\/|README(\.md)?|.*\/README(\.md)?)$/i;

function isDocsOnly(patch: string): boolean {
    const files = filesTouchedByPatch(patch);
    if (files.length === 0) return true;
    return files.every((p) => DOCS_PATH_RE.test(p));
}

interface RunnerSpec {
    cmd: string;
    args: string[];
    label: string;
}

function detectRunner(clonePath: string): RunnerSpec | null {
    const pkgPath = join(clonePath, "package.json");
    if (!existsSync(pkgPath)) return null;
    let pkg: { scripts?: Record<string, string> };
    try {
        pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {
        return null;
    }
    const testScript = pkg.scripts?.test ?? "";
    if (!testScript || /\bno test specified\b/i.test(testScript)) return null;

    if (/\bvitest\b/.test(testScript)) {
        return { cmd: "bun", args: ["x", "vitest", "run", "--pool=threads", "--no-coverage"], label: "vitest" };
    }
    if (/\bjest\b/.test(testScript)) {
        return { cmd: "bun", args: ["x", "jest", "--ci", "--no-coverage"], label: "jest" };
    }
    if (/\bbun test\b/.test(testScript)) {
        return { cmd: "bun", args: ["test"], label: "bun test" };
    }
    if (/\bmocha\b/.test(testScript)) {
        return { cmd: "bun", args: ["x", "mocha"], label: "mocha" };
    }
    return null;
}

export function gateTests(patch: string, clonePath: string): VerificationResult {
    try {
        if (!patch || patch.trim() === "") {
            return { gate: "tests", pass: true, reason: "empty patch (no-op)" };
        }
        if (isDocsOnly(patch)) {
            return { gate: "tests", pass: true, reason: "patch is docs-only; tests skipped" };
        }
        const runner = detectRunner(clonePath);
        if (!runner) {
            return { gate: "tests", pass: true, reason: "no test runner detected; gate skipped" };
        }
        if (process.env.DEVSCOPE_DEPS_INSTALLED !== "1") {
            return {
                gate: "tests",
                pass: true,
                reason: "dependency install failed or skipped; tests gate skipped",
            };
        }

        // Apply patch to a scratch copy of the repo.
        const scratch = mkdtempSync(join(tmpdir(), "devscope-test-"));
        try {
            cpSync(clonePath, scratch, { recursive: true });
            const patchFile = join(scratch, ".devscope.patch");
            writeFileSync(patchFile, patch, "utf8");
            const apply = spawnSync("git", ["apply", patchFile], { cwd: scratch, encoding: "utf8" });
            if (apply.status !== 0) {
                return {
                    gate: "tests",
                    pass: false,
                    reason: `failed to apply patch to scratch tree: ${(apply.stderr || "").slice(0, 200)}`,
                };
            }
            const result = spawnSync(runner.cmd, runner.args, {
                cwd: scratch,
                encoding: "utf8",
                timeout: TEST_TIMEOUT_MS,
                killSignal: "SIGKILL",
            });
            if (result.status === 0) {
                return { gate: "tests", pass: true, reason: `${runner.label} ok` };
            }
            const tail = ((result.stderr || "") + "\n" + (result.stdout || "")).slice(-4096);
            const reason = result.signal
                ? `${runner.label} killed (${result.signal}); tail: ${tail}`
                : `${runner.label} exit=${result.status}; tail: ${tail}`;
            return { gate: "tests", pass: false, reason };
        } finally {
            rmSync(scratch, { recursive: true, force: true });
        }
    } catch (err) {
        return { gate: "tests", pass: false, reason: `gate error: ${(err as Error).message}` };
    }
}

// Exported for tests.
export const __test = { detectRunner, isDocsOnly };
