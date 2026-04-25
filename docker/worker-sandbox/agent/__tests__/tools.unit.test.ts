/**
 * Unit tests for the read-only sandbox tools. Pure stdlib + tmpdir; no
 * Anthropic API or Docker required. Runs as part of `bun test` from
 * `docker/worker-sandbox/agent/`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    pathExists,
    safeResolve,
    toolGrep,
    toolListDir,
    toolReadFile,
} from "../tools";

let repoRoot: string;

beforeAll(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "devscope-tools-"));
    mkdirSync(join(repoRoot, "src"), { recursive: true });
    writeFileSync(join(repoRoot, "CLAUDE.md"), "# Project\n\nNote: be careful.\n");
    writeFileSync(join(repoRoot, "src/index.ts"), "export const x = 1;\n");
    writeFileSync(join(repoRoot, "src/needle.ts"), "// HAYSTACK_TOKEN here\n");
});

afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
});

describe("safeResolve", () => {
    test("accepts repo-relative paths", () => {
        expect(safeResolve(repoRoot, "CLAUDE.md")).toBe(join(repoRoot, "CLAUDE.md"));
        expect(safeResolve(repoRoot, "src/index.ts")).toBe(
            join(repoRoot, "src/index.ts")
        );
        expect(safeResolve(repoRoot, ".")).toBe(repoRoot);
    });

    test("rejects path traversal via ..", () => {
        expect(() => safeResolve(repoRoot, "../etc/passwd")).toThrow(/escapes repo/);
        expect(() => safeResolve(repoRoot, "src/../../outside")).toThrow(
            /escapes repo/
        );
    });

    test("rejects absolute paths", () => {
        expect(() => safeResolve(repoRoot, "/etc/passwd")).toThrow(/absolute/);
    });

    test("rejects empty / non-string input", () => {
        expect(() => safeResolve(repoRoot, "")).toThrow(/non-empty/);
        // @ts-expect-error testing runtime guard
        expect(() => safeResolve(repoRoot, 42)).toThrow(/non-empty/);
    });
});

describe("toolReadFile", () => {
    test("reads file contents", async () => {
        const out = await toolReadFile(repoRoot, { path: "CLAUDE.md" });
        expect(out).toContain("# Project");
    });

    test("rejects path escape", async () => {
        await expect(
            toolReadFile(repoRoot, { path: "../escape" })
        ).rejects.toThrow(/escapes repo/);
    });

    test("rejects absolute path", async () => {
        await expect(toolReadFile(repoRoot, { path: "/etc/passwd" })).rejects.toThrow(
            /absolute/
        );
    });
});

describe("toolListDir", () => {
    test("lists entries with type prefix", async () => {
        const out = await toolListDir(repoRoot, { path: "." });
        expect(out).toMatch(/f CLAUDE\.md/);
        expect(out).toMatch(/d src/);
    });

    test("rejects path escape", async () => {
        await expect(toolListDir(repoRoot, { path: "../" })).rejects.toThrow(
            /escapes repo/
        );
    });
});

describe("toolGrep", () => {
    test("finds matches", () => {
        const out = toolGrep(repoRoot, { pattern: "HAYSTACK_TOKEN" });
        expect(out).toContain("needle.ts");
    });

    test("returns no-matches sentinel cleanly (exit 1 OK)", () => {
        const out = toolGrep(repoRoot, { pattern: "ZZZNOMATCHZZZ" });
        expect(out).toBe("(no matches)");
    });

    test("respects glob filter", () => {
        const out = toolGrep(repoRoot, { pattern: "Project", glob: "*.md" });
        expect(out).toContain("CLAUDE.md");
    });

    test("rejects empty / oversize pattern", () => {
        expect(() => toolGrep(repoRoot, { pattern: "" })).toThrow(/non-empty/);
        expect(() => toolGrep(repoRoot, { pattern: "x".repeat(201) })).toThrow(
            /too long/
        );
    });
});

describe("pathExists", () => {
    test("returns true for present file", async () => {
        expect(await pathExists(repoRoot, "CLAUDE.md")).toBe(true);
    });
    test("returns false for missing file", async () => {
        expect(await pathExists(repoRoot, "nope")).toBe(false);
    });
    test("returns false (no throw) for escape", async () => {
        expect(await pathExists(repoRoot, "../etc/passwd")).toBe(false);
    });
});
