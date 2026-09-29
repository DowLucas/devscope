import { describe, expect, mock, test, beforeEach } from "bun:test";
import { Hono } from "hono";
import { fakeOrgSql } from "../../__test_helpers__/fakeOrgSql";

const mockRunPattern = mock((_sql: unknown, _orgId: string, _days: number) => Promise.resolve([] as any[]));
const mockRunAnti = mock((_sql: unknown, _orgId: string, _days: number) => Promise.resolve([] as any[]));
mock.module("../../ai/workflows/patternWorkflow", () => ({
  createPatternWorkflow: mock(() => ({})),
  runPatternWorkflow: mockRunPattern,
}));
mock.module("../../ai/workflows/antiPatternWorkflow", () => ({
  createAntiPatternWorkflow: mock(() => ({})),
  runAntiPatternWorkflow: mockRunAnti,
}));
const realGemini = await import("../../ai/gemini");
mock.module("../../ai/gemini", () => ({
  ...realGemini,
  isAiAvailable: () => true,
}));

const { patternsRoutes } = await import("../patterns");

const secret = { top_details: { files: ["/secret/path.ts"] } };
const tables = {
  session_patterns: [
    { id: "p-a", organization_id: "org-a", name: "A", tool_sequence: ["Read"], occurrence_count: 3, effectiveness: "effective", data_context: secret },
    { id: "p-b", organization_id: "org-b", name: "B", tool_sequence: ["Bash"], occurrence_count: 9, effectiveness: "effective", data_context: secret },
  ],
  anti_patterns: [
    { id: "ap-a", organization_id: "org-a", name: "A", severity: "warning", detection_rule: "r", occurrence_count: 1, data_context: secret },
    { id: "ap-b", organization_id: "org-b", name: "B", severity: "warning", detection_rule: "r", occurrence_count: 1, data_context: secret },
  ],
};

let sql: ReturnType<typeof fakeOrgSql>;

function buildApp(orgId = "org-a") {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("orgId" as never, orgId as never);
    await next();
  });
  app.route("/patterns", patternsRoutes(sql));
  return app;
}

beforeEach(() => {
  sql = fakeOrgSql(tables);
  mockRunPattern.mockClear();
  mockRunAnti.mockClear();
});

describe("patterns routes are org-scoped", () => {
  test("pattern list returns only the caller's org and omits data_context", async () => {
    const body = await (await buildApp("org-a").request("/patterns")).json() as any[];
    expect(body.map((p) => p.id)).toEqual(["p-a"]);
    expect(JSON.stringify(body)).not.toContain("/secret/path.ts");
  });

  test("another org's pattern id is 404", async () => {
    expect((await buildApp("org-a").request("/patterns/p-b")).status).toBe(404);
    const ok = await buildApp("org-a").request("/patterns/p-a");
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).not.toContain("/secret/path.ts");
  });

  test("anti-pattern list and detail are scoped and omit data_context", async () => {
    const list = await (await buildApp("org-a").request("/patterns/anti")).json() as any[];
    expect(list.map((p) => p.id)).toEqual(["ap-a"]);
    expect(JSON.stringify(list)).not.toContain("/secret/path.ts");
    expect((await buildApp("org-a").request("/patterns/anti/ap-b")).status).toBe(404);
  });

  test("stats and trends queries are bound to the caller's org", async () => {
    const app = buildApp("org-a");
    for (const path of ["/patterns/stats", "/patterns/anti/stats", "/patterns/anti/trends"]) {
      sql.queries.length = 0;
      expect((await app.request(path)).status).toBe(200);
      expect(sql.queries.length).toBeGreaterThan(0);
      for (const q of sql.queries) {
        expect(q.text).toContain("organization_id");
        expect(q.values).toContain("org-a");
      }
    }
  });

  test("POST /analyze runs both workflows for the caller's org only", async () => {
    const res = await buildApp("org-b").request("/patterns/analyze", { method: "POST" });
    expect(res.status).toBe(200);
    expect(mockRunPattern.mock.calls[0]![1]).toBe("org-b");
    expect(mockRunAnti.mock.calls[0]![1]).toBe("org-b");
  });
});
