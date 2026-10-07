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
