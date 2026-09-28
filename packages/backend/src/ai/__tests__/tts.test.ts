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
    const out = await tts.synthesize("cloud needs you", "am_michael", 1.5);
    expect(out?.byteLength).toBe(4);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("http://kokoro.test:8880/v1/audio/speech");
    expect(JSON.parse(init.body)).toEqual({
      model: tts.TTS_MODEL,
      input: "cloud needs you",
      voice: "am_michael",
      speed: 1.5,
      response_format: "wav",
    });
  });

  test("defaults to the configured voice and speed", async () => {
    const f = stubFetch(async () => wav());
    await tts.synthesize("hi");
    const body = JSON.parse(f.mock.calls[0]![1].body);
    expect(body.voice).toBe(tts.TTS_DEFAULTS.voice);
    expect(body.speed).toBe(tts.TTS_DEFAULTS.speed);
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
});
