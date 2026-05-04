// Gate 5: lint (best-effort).
//
// - Detects per-file linter from project config.
// - Runs scoped to touched files only, 30s timeout.
// - For claude_md: looks for markdownlint config; otherwise passes with note.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { VerificationResult } from "../types";
import { filesTouchedByPatch } from "../types";

const LINT_TIMEOUT_MS = 30 * 1000;

function listConfigs(clonePath: string): string[] {
    try {
        return readdirSync(clonePath);
    } catch {
        return [];
    }
}

function hasEslintConfig(clonePath: string, entries: string[]): boolean {
    if (entries.some((e) => /^\.eslintrc(\.|$)/.test(e) || /^eslint\.config\.(js|cjs|mjs|ts)$/.test(e))) {
        return true;
    }
    try {
        const pkg = JSON.parse(readFileSync(join(clonePath, "package.json"), "utf8")) as Record<string, unknown>;
        if (pkg.eslintConfig) return true;
    } catch {}
    return false;
}

function hasMarkdownlintConfig(clonePath: string, entries: string[]): boolean {
    if (entries.some((e) => /^\.markdownlint(\.|rc)/.test(e) || e === ".markdownlint.json" || e === ".markdownlint.yaml")) {
        return true;
    }
    try {
        const pkg = JSON.parse(readFileSync(join(clonePath, "package.json"), "utf8")) as Record<string, unknown>;
        if (pkg["markdownlint"] || (pkg.scripts && /markdownlint/.test(JSON.stringify(pkg.scripts)))) return true;
    } catch {}
    return false;
}

function isMarkdown(p: string): boolean {
    return /\.(md|markdown)$/i.test(p);
}

export function gateLint(patch: string, clonePath: string): VerificationResult {
    try {
        if (!patch || patch.trim() === "") {
            return { gate: "lint", pass: true, reason: "empty patch (no-op)" };
        }
        const files = filesTouchedByPatch(patch);
        if (files.length === 0) {
            return { gate: "lint", pass: true, reason: "no files touched" };
        }

        const entries = listConfigs(clonePath);

        const mdFiles = files.filter(isMarkdown);
        const codeFiles = files.filter((f) => !isMarkdown(f));
        const allMd = mdFiles.length === files.length;

        // Markdown-only path (typical claude_md case).
        if (allMd) {
            if (!hasMarkdownlintConfig(clonePath, entries)) {
                return { gate: "lint", pass: true, reason: "no markdown linter configured" };
            }
            if (process.env.DEVSCOPE_DEPS_INSTALLED !== "1") {
                return { gate: "lint", pass: true, reason: "deps not installed; markdown lint skipped" };
            }
            const result = spawnSync("bun", ["x", "markdownlint", ...mdFiles], {
                cwd: clonePath,
                encoding: "utf8",
                timeout: LINT_TIMEOUT_MS,
                killSignal: "SIGKILL",
            });
            if (result.status === 0) {
                return { gate: "lint", pass: true, reason: `markdownlint ok (${mdFiles.length} file(s))` };
            }
            const tail = ((result.stderr || "") + (result.stdout || "")).slice(-2048);
            return { gate: "lint", pass: false, reason: `markdownlint failed: ${tail}` };
        }

        // Code files: try ESLint if configured.
        if (codeFiles.length > 0 && hasEslintConfig(clonePath, entries)) {
            if (process.env.DEVSCOPE_DEPS_INSTALLED !== "1") {
                return { gate: "lint", pass: true, reason: "deps not installed; eslint skipped" };
            }
            const lintable = codeFiles.filter((f) => /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(f));
            if (lintable.length === 0) {
                return { gate: "lint", pass: true, reason: "no eslint-applicable files touched" };
            }
            const result = spawnSync("bun", ["x", "eslint", "--no-error-on-unmatched-pattern", ...lintable], {
                cwd: clonePath,
                encoding: "utf8",
                timeout: LINT_TIMEOUT_MS,
                killSignal: "SIGKILL",
            });
            if (result.status === 0) {
                return { gate: "lint", pass: true, reason: `eslint ok (${lintable.length} file(s))` };
            }
            const tail = ((result.stderr || "") + (result.stdout || "")).slice(-2048);
            return { gate: "lint", pass: false, reason: `eslint failed: ${tail}` };
        }

        return { gate: "lint", pass: true, reason: "no linter detected for touched files" };
    } catch (err) {
        return { gate: "lint", pass: false, reason: `gate error: ${(err as Error).message}` };
    }
}

export const __test = { hasEslintConfig, hasMarkdownlintConfig, isMarkdown };
