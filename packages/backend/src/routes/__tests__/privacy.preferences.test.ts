import { describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { dbStubs, developerLinkStubs } from "../../__test_helpers__/mockStubs";

const mockUpdate = mock(() => Promise.resolve());
const mockSharing = mock(() => Promise.resolve(true));
mock.module("../../db", () => dbStubs({ updateDeveloperPrivacy: mockUpdate, getDevelopersSharing: mockSharing }));
mock.module("../../services/developerLink", () =>
  developerLinkStubs({ getAllDeveloperIdsForUser: mock(() => Promise.resolve(["dev-laptop", "dev-work"])) }),
);

// Real requireOrgMember and logEthicsEvent; this fake answers the membership
// lookup (and the buffered audit insert) with a member row.
const fakeSql = (() => Promise.resolve([{ role: "member" }])) as any;

const { privacyRoutes } = await import("../privacy");

function app() {
  const a = new Hono();
  a.use("*", async (c, next) => {
    c.set("user" as never, { id: "user-1" } as never);
    c.set("orgId" as never, "org-1" as never);
    c.set("session" as never, { activeOrganizationId: "org-1" } as never);
    await next();
  });
  a.route("/privacy", privacyRoutes(fakeSql));
  return a;
}

describe("consent preferences", () => {
  test("turning sharing off updates every linked developer identity", async () => {
    const res = await app().request("/privacy/consent/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share_details: false }),
    });
    expect(res.status).toBe(200);
    expect((mockUpdate.mock.calls.at(-1) as any[]).slice(1)).toEqual([["dev-laptop", "dev-work"], false]);
  });

  test("reads the state across every linked identity", async () => {
    const body = await (await app().request("/privacy/consent/preferences")).json();
    expect(body).toEqual({ linked: true, share_details: true });
    expect((mockSharing.mock.calls.at(-1) as any[])[1]).toEqual(["dev-laptop", "dev-work"]);
  });
});
