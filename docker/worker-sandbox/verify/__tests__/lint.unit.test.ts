import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateLint, __test } from "../gates/lint";

const { hasEslintConfig, hasMarkdownlintConfig, isMarkdown } = __test;

let tmps: string[] = [];
function makeRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "devscope-lint-"));
    tmps.push(dir);
    return dir;
}

afterEach(() => {
    for (const t of tmps) rmSync(t, { recursive: true, force: true });
    tmps = [];
});

const mdPatch =
    "diff --git a/CLAUDE.md b/CLAUDE.md\n--- a/CLAUDE.md\n+++ b/CLAUDE.md\n@@ -1 +1,2 @@\n # x\n+y\n";
const tsPatch =
    "diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1,2 @@\n const a = 1;\n+const b = 2;\n";

describe("gateLint", () => {
    test("isMarkdown", () => {
        expect(isMarkdown("CLAUDE.md")).toBe(true);
        expect(isMarkdown("a/b/x.markdown")).toBe(true);
        expect(isMarkdown("foo.ts")).toBe(false);
    });

    test("md-only: no markdown linter -> pass with note", () => {
        const repo = makeRepo();
        const r = gateLint(mdPatch, repo);
        expect(r.pass).toBe(true);
        expect(r.reason).toContain("no markdown linter");
    });

    test("md-only: markdownlint config detected but deps missing -> skip", () => {
        const repo = makeRepo();
        writeFileSync(join(repo, ".markdownlint.json"), "{}");
        const prev = process.env.DEVSCOPE_DEPS_INSTALLED;
        delete process.env.DEVSCOPE_DEPS_INSTALLED;
        try {
            const r = gateLint(mdPatch, repo);
            expect(r.pass).toBe(true);
            expect(r.reason).toContain("deps not installed");
        } finally {
            if (prev !== undefined) process.env.DEVSCOPE_DEPS_INSTALLED = prev;
        }
    });

    test("code files: no eslint config -> no linter detected, pass", () => {
        const repo = makeRepo();
        const r = gateLint(tsPatch, repo);
        expect(r.pass).toBe(true);
        expect(r.reason).toContain("no linter detected");
    });

    test("code files: eslint config present, deps missing -> skip", () => {
        const repo = makeRepo();
        writeFileSync(join(repo, ".eslintrc.json"), "{}");
        const prev = process.env.DEVSCOPE_DEPS_INSTALLED;
        delete process.env.DEVSCOPE_DEPS_INSTALLED;
        try {
            const r = gateLint(tsPatch, repo);
            expect(r.pass).toBe(true);
            expect(r.reason).toContain("deps not installed");
        } finally {
            if (prev !== undefined) process.env.DEVSCOPE_DEPS_INSTALLED = prev;
        }
    });

    test("hasEslintConfig detects flat config", () => {
        const repo = makeRepo();
        writeFileSync(join(repo, "eslint.config.js"), "");
        expect(hasEslintConfig(repo, ["eslint.config.js"])).toBe(true);
    });

    test("hasMarkdownlintConfig detects rc file", () => {
        const repo = makeRepo();
        writeFileSync(join(repo, ".markdownlintrc"), "");
        expect(hasMarkdownlintConfig(repo, [".markdownlintrc"])).toBe(true);
    });

    test("empty patch passes", () => {
        const repo = makeRepo();
        const r = gateLint("", repo);
        expect(r.pass).toBe(true);
    });
});
