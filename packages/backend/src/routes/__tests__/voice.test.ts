import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { dbStubs } from "../../__test_helpers__/mockStubs";

mock.module("../../db", () => dbStubs());

let available = true;
const mockSynthesize = mock(async () => new Uint8Array([82, 73, 70, 70]).buffer as ArrayBuffer | null);
mock.module("../../ai/tts", () => ({
  isTtsAvailable: () => available,
  synthesize: mockSynthesize,
  ttsServices: () => [{ name: "chatterbox", url: "http://c" }, { name: "kokoro", url: "http://k" }],
  TTS_DEFAULTS: { voice: "am_michael", speed: 1.2, volume: 2 },
  TTS_MODEL: "kokoro",
}));

const mockGemini = mock(async () => ({ text: "It needs approval to run the tests.", inputTokens: 10, outputTokens: 5 }));
mock.module("../../ai/gemini", () => ({
  callGemini: mockGemini,
  isAiAvailable: () => true,
  DEFAULT_MODEL: "gemini-2.5-flash",
}));

let ownDevIds = ["dev-me"];
mock.module("../../services/visibility", () => ({
  getOwnOrgDevIds: async () => ownDevIds,
}));

const { voiceRoutes } = await import("../voice");

let userSeq = 0;
function buildApp(userId = `user-${++userSeq}`) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, { id: userId } as never);
    await next();
  });
  app.route("/api/ai", voiceRoutes({} as any));
  return app;
}

const post = (app: Hono, body: unknown) =>
  app.request("/api/ai/voice-audio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  available = true;
  mockSynthesize.mockClear();
  mockSynthesize.mockImplementation(async () => new Uint8Array([82, 73, 70, 70]).buffer);
});

describe("POST /api/ai/voice-audio", () => {
  test("returns WAV from the TTS service", async () => {
    const res = await post(buildApp(), { text: "cloud needs you", voice: "am_michael", speed: 1.5, volume: 2.5 });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect((await res.arrayBuffer()).byteLength).toBe(4);
    expect(mockSynthesize).toHaveBeenCalledWith("cloud needs you", "am_michael", 1.5, 2.5, undefined);
  });

  test("passes the requested voice model, and rejects a malformed name", async () => {
    await post(buildApp(), { text: "hi", model: "kokoro" });
    expect((mockSynthesize.mock.calls[0] as unknown[])[4]).toBe("kokoro");
    expect((await post(buildApp(), { text: "hi", model: "../etc" })).status).toBe(400);
  });

  test("GET /voice-models lists the voices, default first", async () => {
    const res = await buildApp().request("/api/ai/voice-models");
    expect(await res.json()).toEqual({ models: ["chatterbox", "kokoro"] });
  });

  test("503 when no TTS service is configured, without calling it", async () => {
    available = false;
    const res = await post(buildApp(), { text: "cloud needs you" });
    expect(res.status).toBe(503);
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  test("503 when the TTS service fails", async () => {
    mockSynthesize.mockImplementation(async () => null);
    expect((await post(buildApp(), { text: "cloud needs you" })).status).toBe(503);
  });

  test("400 for invalid input", async () => {
    const app = buildApp();
    expect((await post(app, { text: "" })).status).toBe(400);
    expect((await post(app, { text: "hi", voice: "../../etc" })).status).toBe(400);
    expect((await post(app, { text: "hi", volume: 10 })).status).toBe(400);
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  test("rate-limited per user at 20 a minute", async () => {
    const app = buildApp();
    for (let i = 0; i < 20; i++) expect((await post(app, { text: "hi" })).status).toBe(200);
    expect((await post(app, { text: "hi" })).status).toBe(429);
    // Another user has their own bucket.
    expect((await post(buildApp(), { text: "hi" })).status).toBe(200);
  });
});

describe("POST /api/ai/voice-summary (session labels)", () => {
  let session: Record<string, unknown> | undefined;
  let queries = 0;
  // Stands in for Bun.sql: the only query is the session lookup.
  const fakeSql = (async () => {
    queries++;
    return session ? [session] : [];
  }) as any;

  function summaryApp() {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user" as never, { id: `user-${++userSeq}` } as never);
      await next();
    });
    app.route("/api/ai", voiceRoutes(fakeSql));
    return app;
  }

  const summarize = (body: unknown) =>
    summaryApp().request("/api/ai/voice-summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    ownDevIds = ["dev-me"];
    queries = 0;
    session = { developer_id: "dev-me", current_title: "Rate limiter fix", git_branch: "fix/rate-limit", privacy_mode: "standard" };
    mockGemini.mockClear();
  });

  test("starts with project and title, and returns the label", async () => {
    const res = await summarize({ trigger: "permission", project: "api-service", session_id: "s1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      text: "api-service, Rate limiter fix. It needs approval to run the tests.",
      label: "api-service, Rate limiter fix",
    });
    const prompt = (mockGemini.mock.calls[0] as unknown as [{ parts: { text: string }[] }[]])[0][0].parts[0].text;
    expect(prompt).toContain("do not repeat the project name");
  });

  test("falls back to the branch when the session has no title yet", async () => {
    session = { ...session, current_title: null };
    const res = await summarize({ trigger: "finished", project: "api-service", session_id: "s1" });
    expect((await res.json()).label).toBe("api-service, rate limit");
  });

  test("never names another developer's session", async () => {
    ownDevIds = ["dev-someone-else"];
    const res = await summarize({ trigger: "finished", project: "api-service", session_id: "s1" });
    expect((await res.json()).label).toBe("api-service");
  });

  test("reuses a label the plugin sends back, without a lookup", async () => {
    const res = await summarize({ trigger: "finished", project: "api-service", session_id: "s1", label: "api-service, first name" });
    expect((await res.json()).label).toBe("api-service, first name");
    expect(queries).toBe(0);
  });

  test("older plugins without a session id keep the old wording", async () => {
    const res = await summarize({ trigger: "finished", project: "api-service" });
    expect(await res.json()).toEqual({ text: "It needs approval to run the tests." });
    const prompt = (mockGemini.mock.calls[0] as unknown as [{ parts: { text: string }[] }[]])[0][0].parts[0].text;
    expect(prompt).toContain("Start with the project name");
  });

  test("a failed lookup still answers, labelled with the project", async () => {
    const failing = (async () => { throw new Error("db down"); }) as any;
    const app = new Hono();
    app.route("/api/ai", voiceRoutes(failing));
    const res = await app.request("/api/ai/voice-summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trigger: "finished", project: "api-service", session_id: "s1" }),
    });
    expect((await res.json()).label).toBe("api-service");
  });
});
