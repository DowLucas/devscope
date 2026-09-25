import { describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { developerLinkStubs } from "../../__test_helpers__/mockStubs";

const mockFind = mock(() => Promise.resolve([
  { session_id: "s1", prompt_text: "fix the auth test", success_rate: 1, tool_count: 2, similarity: 0.5 },
]));
mock.module("../../db/promptSimilarityQueries", () => ({ findSimilarPrompts: mockFind }));
mock.module("../../services/developerLink", () =>
  developerLinkStubs({ getAllDeveloperIdsForUser: mock(() => Promise.resolve(["dev-me"])) }),
);

const { promptSimilarityRoutes } = await import("../promptSimilarity");

function post(developerId: string) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, { id: "user-1" } as never);
    await next();
  });
  app.route("/prompts", promptSimilarityRoutes({} as any));
  return app.request("/prompts/similar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: "s0", developer_id: developerId, project_path: "/p", prompt_text: "fix auth" }),
  });
}

describe("POST /prompts/similar", () => {
  test("returns the caller's own similar prompts", async () => {
    const body = await (await post("dev-me")).json();
    expect(body.matches).toHaveLength(1);
  });

  test("returns nothing for another developer's id without querying", async () => {
    mockFind.mockClear();
    const res = await post("dev-someone-else");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matches: [], lines: [] });
    expect(mockFind).not.toHaveBeenCalled();
  });
});
