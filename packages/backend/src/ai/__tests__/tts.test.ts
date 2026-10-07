import { afterEach, describe, expect, mock, test } from "bun:test";

// The module reads TTS_URL at import time.
process.env.TTS_URL = "http://kokoro.test:8880/";
const tts = await import("../tts");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(impl: (...args: any[]) => Promise<Response>) {
  const f = mock(impl);
  globalThis.fetch = f as any;
  return f;
}

const wav = () => new Response(new Uint8Array([82, 73, 70, 70]), { headers: { "content-type": "audio/wav" } });

describe("tts client", () => {
  test("posts to the OpenAI-compatible speech endpoint and returns audio", async () => {
    const f = stubFetch(async () => wav());
    const out = await tts.synthesize("cloud needs you", "am_michael", 1.5, 2.5);
    expect(out?.byteLength).toBe(4);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("http://kokoro.test:8880/v1/audio/speech");
    expect(JSON.parse(init.body)).toEqual({
      model: tts.TTS_MODEL,
      input: "cloud needs you",
      voice: "am_michael",
      speed: 1.5,
      volume_multiplier: 2.5,
      response_format: "wav",
    });
  });

  test("defaults to the configured voice and speed", async () => {
    const f = stubFetch(async () => wav());
    await tts.synthesize("hi");
    const body = JSON.parse(f.mock.calls[0]![1].body);
    expect(body.voice).toBe(tts.TTS_DEFAULTS.voice);
    expect(body.speed).toBe(tts.TTS_DEFAULTS.speed);
    expect(body.volume_multiplier).toBe(tts.TTS_DEFAULTS.volume);
  });

  test("non-200, non-audio, empty and network errors return null", async () => {
    stubFetch(async () => new Response("nope", { status: 500 }));
    expect(await tts.synthesize("x")).toBeNull();
    stubFetch(async () => Response.json({ error: "bad voice" }));
    expect(await tts.synthesize("x")).toBeNull();
    stubFetch(async () => new Response(new Uint8Array(), { headers: { "content-type": "audio/wav" } }));
    expect(await tts.synthesize("x")).toBeNull();
    stubFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await tts.synthesize("x")).toBeNull();
  });

  describe("with a fallback (TTS_FALLBACK_URL)", () => {
    afterEach(() => {
      delete process.env.TTS_FALLBACK_URL;
      delete process.env.TTS_PRIMARY_TIMEOUT_MS;
    });

    test("the voice answers: the fallback is never asked", async () => {
      process.env.TTS_FALLBACK_URL = "http://fallback.test:8880";
      const f = stubFetch(async () => wav());
      expect((await tts.synthesize("x"))?.byteLength).toBe(4);
      expect(f.mock.calls.map((c) => c[0])).toEqual(["http://kokoro.test:8880/v1/audio/speech"]);
    });

    test("the voice is busy or broken: the fallback speaks, with the same request", async () => {
      process.env.TTS_FALLBACK_URL = "http://fallback.test:8880/";
      const f = stubFetch(async (url: string) =>
        url.startsWith("http://kokoro.test") ? Response.json({ error: "busy" }, { status: 503 }) : wav(),
      );
      expect((await tts.synthesize("cloud needs you", "am_michael", 1.2, 2))?.byteLength).toBe(4);
      expect(f.mock.calls.map((c) => c[0])).toEqual([
        "http://kokoro.test:8880/v1/audio/speech",
        "http://fallback.test:8880/v1/audio/speech",
      ]);
      expect(f.mock.calls[1]![1].body).toBe(f.mock.calls[0]![1].body);
    });

    test("the voice gets only TTS_PRIMARY_TIMEOUT_MS before the fallback", async () => {
      process.env.TTS_FALLBACK_URL = "http://fallback.test:8880";
      process.env.TTS_PRIMARY_TIMEOUT_MS = "50";
      const started = Date.now();
      stubFetch((url: string, init: RequestInit) =>
        url.startsWith("http://kokoro.test")
          ? new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("timeout"))))
          : Promise.resolve(wav()),
      );
      expect((await tts.synthesize("x"))?.byteLength).toBe(4);
      expect(Date.now() - started).toBeLessThan(2000);
    });

    test("both fail: null, so the plugin uses a local voice", async () => {
      process.env.TTS_FALLBACK_URL = "http://fallback.test:8880";
      stubFetch(async () => new Response("nope", { status: 500 }));
      expect(await tts.synthesize("x")).toBeNull();
    });
  });
});
