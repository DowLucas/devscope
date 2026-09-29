import { describe, expect, mock, test, beforeEach } from "bun:test";
import { Hono } from "hono";
import { fakeOrgSql } from "../../__test_helpers__/fakeOrgSql";

const mockRunPlaybookWorkflow = mock((_sql: unknown, _orgId: string) => Promise.resolve([] as any[]));
mock.module("../../ai/workflows/playbookWorkflow", () => ({
  createPlaybookWorkflow: mock(() => ({})),
  runPlaybookWorkflow: mockRunPlaybookWorkflow,
}));
const realGemini = await import("../../ai/gemini");
mock.module("../../ai/gemini", () => ({
  ...realGemini,
  isAiAvailable: () => true,
}));

const { playbooksRoutes } = await import("../playbooks");

const tables = {
  playbooks: [
    { id: "pb-a", organization_id: "org-a", name: "A's playbook", status: "active", source_pattern_id: null },
    { id: "pb-b", organization_id: "org-b", name: "B's playbook", status: "active", source_pattern_id: null },
  ],
};

let sql: ReturnType<typeof fakeOrgSql>;

function buildApp(orgId = "org-a") {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("orgId" as never, orgId as never);
    await next();
  });
  app.route("/playbooks", playbooksRoutes(sql));
  return app;
}

beforeEach(() => {
  sql = fakeOrgSql(tables);
  mockRunPlaybookWorkflow.mockClear();
});

describe("playbooks routes are org-scoped", () => {
  test("list returns only the caller's org", async () => {
    const res = await buildApp("org-a").request("/playbooks");
    expect(res.status).toBe(200);
    expect((await res.json() as any[]).map((p) => p.id)).toEqual(["pb-a"]);
  });

  test("GET another org's playbook id is 404", async () => {
    expect((await buildApp("org-a").request("/playbooks/pb-b")).status).toBe(404);
    expect((await buildApp("org-a").request("/playbooks/pb-a")).status).toBe(200);
  });

  test("PUT another org's playbook id is 404 and never writes", async () => {
    const res = await buildApp("org-a").request("/playbooks/pb-b", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "hijacked" }),
    });
    expect(res.status).toBe(404);
    expect(sql.queries.some((q) => /^UPDATE/i.test(q.text))).toBe(false);
  });

  test("DELETE another org's playbook id is 404 and never writes", async () => {
    const res = await buildApp("org-a").request("/playbooks/pb-b", { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(sql.queries.some((q) => /^UPDATE/i.test(q.text))).toBe(false);
  });

  test("updates and archives are also filtered by org in SQL (defence in depth)", async () => {
    const app = buildApp("org-a");
    await app.request("/playbooks/pb-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    await app.request("/playbooks/pb-a", { method: "DELETE" });
    const writes = sql.queries.filter((q) => /^UPDATE/i.test(q.text));
    expect(writes.length).toBe(2);
    for (const w of writes) {
      expect(w.text).toContain("organization_id");
      expect(w.values).toContain("org-a");
    }
  });

  test("create stamps the caller's org", async () => {
    const res = await buildApp("org-a").request("/playbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "n", description: "d", tool_sequence: ["Read"], when_to_use: "w" }),
    });
    expect(res.status).toBe(201);
    const insert = sql.queries.find((q) => /^INSERT INTO playbooks/i.test(q.text))!;
    expect(insert.text).toContain("organization_id");
    expect(insert.values).toContain("org-a");
  });

  test("generate runs for the caller's org only", async () => {
    const res = await buildApp("org-b").request("/playbooks/generate", { method: "POST" });
    expect(res.status).toBe(200);
    expect(mockRunPlaybookWorkflow.mock.calls[0]![1]).toBe("org-b");
  });
});
