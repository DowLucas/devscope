import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";

// In-memory fake keyed by (id, orgId) so the route's org scoping is what's under test.
const skills: Record<string, any> = {
  "skill-a": { id: "skill-a", organization_id: "org-a", name: "A", description: "d", trigger_phrases: ["x"], skill_body: "body", status: "draft", version: 1 },
};
const owned = (id: string, orgId: string) => (skills[id]?.organization_id === orgId ? skills[id] : null);

const mockGet = mock(async (_s: any, id: string, orgId: string) => owned(id, orgId));
const mockUpdate = mock(async (_s: any, id: string, orgId: string, u: any) => {
  const sk = owned(id, orgId);
  return sk ? { ...sk, ...u } : null;
});
const mockArchive = mock(async (_s: any, id: string, orgId: string) => !!owned(id, orgId));
const mockApprove = mock(async (_s: any, id: string, orgId: string) => {
  const sk = owned(id, orgId);
  return sk ? { ...sk, status: "approved" } : null;
});
const mockLinks = mock(async (_s: any, id: string, orgId: string) => (owned(id, orgId) ? [{ id: "l1" }] : []));
const mockVersions = mock(async (_s: any, id: string, orgId: string) => {
  const sk = owned(id, orgId);
  return sk ? [sk] : [];
});
const mockRefine = mock(async () => ({ id: "refined" }));

mock.module("../../db/teamSkillQueries", () => ({
  createTeamSkill: mock(async () => null),
  getTeamSkills: mock(async () => []),
  getTeamSkillById: mockGet,
  updateTeamSkill: mockUpdate,
  archiveTeamSkill: mockArchive,
  approveTeamSkill: mockApprove,
  linkSkillToPattern: mock(async () => null),
  getSkillPatternLinks: mockLinks,
  getSkillVersionHistory: mockVersions,
  getOrgSkillStats: mock(async () => ({})),
  getActiveSkillNames: mock(async () => []),
}));
mock.module("../../ai/gemini", () => ({ isAiAvailable: () => true }));
mock.module("../../ai/workflows/skillGenerationWorkflow", () => ({ runSkillGenerationWorkflow: mock(async () => []) }));
mock.module("../../ai/workflows/skillRefinementWorkflow", () => ({ runSkillRefinementWorkflow: mockRefine }));

const { teamSkillsRoutes } = await import("../teamSkills");

function buildApp(orgId: string) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("orgId" as never, orgId as never);
    c.set("user" as never, { id: "user-1" } as never);
    await next();
  });
  app.route("/team-skills", teamSkillsRoutes({} as any));
  return app;
}

const json = (body: unknown) => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("team skills org scoping", () => {
  beforeEach(() => {
    mockRefine.mockClear();
  });

  const attacker = () => buildApp("org-b");

  test("GET /:id returns 404 for another org's skill", async () => {
    expect((await attacker().request("/team-skills/skill-a")).status).toBe(404);
  });

  test("PUT /:id returns 404 for another org's skill", async () => {
    const res = await attacker().request("/team-skills/skill-a", json({ status: "active" }));
    expect(res.status).toBe(404);
  });

  test("DELETE /:id returns 404 for another org's skill", async () => {
    expect((await attacker().request("/team-skills/skill-a", { method: "DELETE" })).status).toBe(404);
  });

  test("POST /:id/approve returns 404 for another org's skill", async () => {
    expect((await attacker().request("/team-skills/skill-a/approve", { method: "POST" })).status).toBe(404);
  });

  test("POST /:id/refine returns 404 and never runs the workflow for another org's skill", async () => {
    const res = await attacker().request("/team-skills/skill-a/refine", { method: "POST" });
    expect(res.status).toBe(404);
    expect(mockRefine).not.toHaveBeenCalled();
  });

  test("GET /:id/export returns 404 for another org's skill", async () => {
    expect((await attacker().request("/team-skills/skill-a/export")).status).toBe(404);
  });

  test("GET /:id/versions returns 404 for another org's skill", async () => {
    expect((await attacker().request("/team-skills/skill-a/versions")).status).toBe(404);
  });

  test("owning org can use every /:id route", async () => {
    const app = buildApp("org-a");
    const get = await app.request("/team-skills/skill-a");
    expect(get.status).toBe(200);
    expect((await get.json()).links).toHaveLength(1);
    expect((await app.request("/team-skills/skill-a", json({ name: "New" }))).status).toBe(200);
    expect((await app.request("/team-skills/skill-a/approve", { method: "POST" })).status).toBe(200);
    expect((await app.request("/team-skills/skill-a/export")).status).toBe(200);
    expect((await app.request("/team-skills/skill-a/versions")).status).toBe(200);
    expect((await app.request("/team-skills/skill-a/refine", { method: "POST" })).status).toBe(200);
    expect(mockRefine).toHaveBeenCalledTimes(1);
    expect((await app.request("/team-skills/skill-a", { method: "DELETE" })).status).toBe(200);
  });

  test("passes the caller's orgId to the queries", async () => {
    await attacker().request("/team-skills/skill-a");
    expect(mockGet.mock.calls.at(-1)?.[2]).toBe("org-b");
  });

  test("PUT rejects invalid bodies", async () => {
    const app = buildApp("org-a");
    for (const body of [
      { status: "bogus" },
      { name: 42 },
      { name: "" },
      { trigger_phrases: "x" },
      { organization_id: "org-b" },
      { skill_body: "x".repeat(50_001) },
    ]) {
      expect((await app.request("/team-skills/skill-a", json(body))).status).toBe(400);
    }
    const bad = await app.request("/team-skills/skill-a", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "not json" });
    expect(bad.status).toBe(400);
  });
});
