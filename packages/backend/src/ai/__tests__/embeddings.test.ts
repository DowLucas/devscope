import { afterEach, describe, expect, mock, test } from "bun:test";

// The module reads EMBEDDING_URL at import time.
process.env.EMBEDDING_URL = "http://ollama.test:11434/";
const emb = await import("../embeddings");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function vec(n = emb.EMBEDDING_DIM) {
  return new Array(n).fill(0.01);
}

function stubFetch(impl: (...args: any[]) => Promise<Response>) {
  const f = mock(impl);
  globalThis.fetch = f as any;
  return f;
}

describe("embeddings client", () => {
  test("posts a batch to /api/embed and returns vectors", async () => {
    const f = stubFetch(async () => Response.json({ embeddings: [vec(), vec()] }));
    const out = await emb.embedDocuments(["a", "b"]);
    expect(out).toHaveLength(2);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("http://ollama.test:11434/api/embed");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: emb.EMBEDDING_MODEL, input: ["a", "b"], truncate: true });
  });

  test("query side is instruction-prefixed", async () => {
    const f = stubFetch(async () => Response.json({ embeddings: [vec()] }));
    const out = await emb.embedQuery("fix the build");
    expect(out).toHaveLength(emb.EMBEDDING_DIM);
    const body = JSON.parse(f.mock.calls[0]![1].body);
    expect(body.input[0]).toStartWith("Instruct: ");
    expect(body.input[0]).toEndWith("Query: fix the build");
  });

  test.each([
    ["non-200", async () => new Response("boom", { status: 500 })],
    ["network error", async () => { throw new Error("ECONNREFUSED"); }],
    ["wrong dimension", async () => Response.json({ embeddings: [vec(768)] })],
    ["wrong count", async () => Response.json({ embeddings: [] })],
    ["non-finite values", async () => Response.json({ embeddings: [[...vec(1023), null]] })],
    ["malformed body", async () => Response.json({ nope: true })],
  ])("fails open to null on %s", async (_label, impl) => {
    stubFetch(impl as any);
    expect(await emb.embedDocuments(["a"])).toBeNull();
  });

  test("empty input makes no request", async () => {
    const f = stubFetch(async () => Response.json({ embeddings: [] }));
    expect(await emb.embedDocuments([])).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("text preparation", () => {
  test("prompts keep the head, capped at 8k chars", () => {
    expect(emb.preparePromptText("  hi  ")).toBe("hi");
    expect(emb.preparePromptText("x".repeat(10_000))).toHaveLength(8_000);
  });

  test("responses keep head and tail", () => {
    const text = "H".repeat(5_000) + "T".repeat(5_000);
    const out = emb.prepareResponseText(text);
    expect(out.startsWith("H".repeat(4_000))).toBe(true);
    expect(out.endsWith("T".repeat(2_000))).toBe(true);
    expect(out.length).toBeLessThan(text.length);
    expect(emb.prepareResponseText("short")).toBe("short");
  });

  test("content hash is stable and content-sensitive", () => {
    expect(emb.contentHash("a")).toBe(emb.contentHash("a"));
    expect(emb.contentHash("a")).not.toBe(emb.contentHash("b"));
  });
});
