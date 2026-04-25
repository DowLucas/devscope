import { describe, expect, test } from "bun:test";
import { persistArtifact } from "../src/persistArtifact";
import type { SandboxArtifact } from "../src/sandboxRunner";

type Call = { query: string; values: unknown[] };

function makeSql(insertedRow: Record<string, unknown>) {
  const calls: Call[] = [];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    return Promise.resolve([insertedRow]);
  }) as any;
  fn.calls = calls;
  return fn;
}

function dbRow(status: "shadow" | "failed", overrides: Record<string, unknown> = {}) {
  return {
    id: "art-1",
    candidate_id: "cand-1",
    patch: "",
    files_changed: [],
    title: "",
    body: "",
    model: "stub",
    verification_results: [],
    rubric_scores: null,
    quality_ranking: null,
    status,
    github_pr_number: null,
    github_branch: null,
    published_at: null,
    created_at: "2026-04-25T00:00:00Z",
    ...overrides,
  };
}

describe("persistArtifact", () => {
  test("failed sandbox artifact -> DB row written with status 'failed' and verification_results carried through", async () => {
    const verification = [
      { gate: "patch_applies" as const, pass: false, reason: "sandbox stub" },
    ];
    const sandbox: SandboxArtifact = {
      patch: "",
      filesChanged: [],
      title: "",
      body: "",
      model: "stub",
      verificationResults: verification,
      status: "failed",
      reason: "sandbox not implemented",
    };
    const sql = makeSql(
      dbRow("failed", {
        verification_results: verification,
        title: "(sandbox failed)",
        body: "sandbox not implemented",
      })
    );

    const out = await persistArtifact(sql, "cand-1", sandbox);

    expect(out.status).toBe("failed");
    expect(out.verificationResults).toEqual(verification);

    expect(sql.calls).toHaveLength(1);
    const call = sql.calls[0]!;
    expect(call.query).toMatch(/INSERT INTO suggestion_artifacts/);
    // Coerced status passed to the query
    expect(call.values).toContain("failed");
    // Reason surfaces through to the body fallback
    expect(call.values).toContain("sandbox not implemented");
  });

  test("passed sandbox artifact -> DB row written with status 'shadow'", async () => {
    const verification = [
      { gate: "patch_applies" as const, pass: true, reason: "ok" },
      { gate: "evidence_dereferences" as const, pass: true, reason: "ok" },
    ];
    const sandbox: SandboxArtifact = {
      patch: "diff --git a/x b/x\n",
      filesChanged: ["x"],
      title: "Add lint rule",
      body: "Because reasons.",
      model: "claude-opus-4-7",
      verificationResults: verification,
      status: "completed",
    };
    const sql = makeSql(
      dbRow("shadow", {
        patch: sandbox.patch,
        files_changed: sandbox.filesChanged,
        title: sandbox.title,
        body: sandbox.body,
        model: sandbox.model,
        verification_results: verification,
      })
    );

    const out = await persistArtifact(sql, "cand-1", sandbox);

    expect(out.status).toBe("shadow");
    expect(out.title).toBe("Add lint rule");
    expect(out.filesChanged).toEqual(["x"]);

    const call = sql.calls[0]!;
    expect(call.values).toContain("shadow");
    expect(call.values).toContain("Add lint rule");
  });
});
