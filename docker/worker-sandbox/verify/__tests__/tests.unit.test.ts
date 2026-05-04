import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateTests, __test } from "../gates/tests";

const { detectRunner, isDocsOnly } = __test;

let tmps: string[] = [];
function makeRepo(pkg?: object): string {
    const dir = mkdtempSync(join(tmpdir(), "devscope-tests-"));
    tmps.push(dir);
    if (pkg) writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
    return dir;
}

afterEach(() => {
    for (const t of tmps) rmSync(t, { recursive: true, force: true });
    tmps = [];
});

const docsPatch =
    "diff --git a/CLAUDE.md b/CLAUDE.md\n--- a/CLAUDE.md\n+++ b/CLAUDE.md\n@@ -1 +1,2 @@\n # x\n+y\n";
const codePatch =
    "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1,2 @@\n const a = 1;\n+const b = 2;\n";

describe("gateTests", () => {
    test("isDocsOnly recognises CLAUDE.md only patches", () => {
        expect(isDocsOnly(docsPatch)).toBe(true);
        expect(isDocsOnly(codePatch)).toBe(false);
    });

    test("skipped for docs-only patches", () => {
        const repo = makeRepo({ scripts: { test: "vitest" } });
        const r = gateTests(docsPatch, repo);
        expect(r.pass).toBe(true);
        expect(r.reason).toContain("docs-only");
    });

    test("skipped when no test runner detected", () => {
        const repo = makeRepo({ scripts: { test: 'echo "no test specified"' } });
        const r = gateTests(codePatch, repo);
        expect(r.pass).toBe(true);
        expect(r.reason).toContain("no test runner");
    });

    test("skipped when no package.json", () => {
        const repo = makeRepo();
        const r = gateTests(codePatch, repo);
        expect(r.pass).toBe(true);
        expect(r.reason).toContain("no test runner");
    });

    test("detectRunner finds vitest/jest/bun/mocha", () => {
        const v = makeRepo({ scripts: { test: "vitest run" } });
        const j = makeRepo({ scripts: { test: "jest" } });
        const b = makeRepo({ scripts: { test: "bun test" } });
        const m = makeRepo({ scripts: { test: "mocha 'src/**/*.test.ts'" } });
        expect(detectRunner(v)?.label).toBe("vitest");
        expect(detectRunner(j)?.label).toBe("jest");
        expect(detectRunner(b)?.label).toBe("bun test");
        expect(detectRunner(m)?.label).toBe("mocha");
    });

    test("skipped when deps not installed even if runner detected", () => {
        const repo = makeRepo({ scripts: { test: "vitest" } });
        // Initialize a git repo so apply could work, but since deps are not
        // installed we expect the gate to short-circuit with skip.
        mkdirSync(join(repo, ".git"), { recursive: true });
        const prev = process.env.DEVSCOPE_DEPS_INSTALLED;
        delete process.env.DEVSCOPE_DEPS_INSTALLED;
        try {
            const r = gateTests(codePatch, repo);
            expect(r.pass).toBe(true);
            expect(r.reason).toContain("dependency install");
        } finally {
            if (prev !== undefined) process.env.DEVSCOPE_DEPS_INSTALLED = prev;
        }
    });

    test("empty patch passes trivially", () => {
        const repo = makeRepo();
        const r = gateTests("", repo);
        expect(r.pass).toBe(true);
    });
});
