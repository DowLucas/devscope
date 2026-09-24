import { createHash } from "crypto";

/**
 * Local embedding client (Ollama).
 *
 * Embeddings power semantic retrieval over prompt/response turns. The model
 * runs on the homelab's own Ollama, so prompt and response text never leave
 * the box: no third-party privacy gate is involved.
 *
 * Like `askSystemOne`, every function here never throws. It returns null on a
 * missing URL, timeout, non-200 or malformed body, and callers fall back
 * (the indexing job retries next tick; the search route answers 503).
 */

const EMBEDDING_URL = process.env.EMBEDDING_URL?.replace(/\/+$/, "");
if (!EMBEDDING_URL) {
  console.warn("[embeddings] EMBEDDING_URL not set — semantic retrieval disabled");
}

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "qwen3-embedding:0.6b";

/** Must match the vector(N) columns in migration 045. */
export const EMBEDDING_DIM = 1024;

const DEFAULT_TIMEOUT_MS = 60_000;
const QUERY_TIMEOUT_MS = 10_000;

// Qwen3-Embedding is instruction-aware on the query side only; documents are
// embedded raw. Without the instruction retrieval quality drops noticeably.
const QUERY_INSTRUCTION =
  "Instruct: Given a developer's request to an AI coding agent, retrieve similar past requests\nQuery: ";

const MAX_PROMPT_CHARS = 8_000;
const RESPONSE_HEAD_CHARS = 4_000;
const RESPONSE_TAIL_CHARS = 2_000;

export function isEmbeddingAvailable(): boolean {
  return !!EMBEDDING_URL;
}

/** Prompts: the request is up front, so keep the head. */
export function preparePromptText(text: string): string {
  return text.trim().slice(0, MAX_PROMPT_CHARS);
}

/** Responses: keep the head (approach) and the tail (conclusion). */
export function prepareResponseText(text: string): string {
  const t = text.trim();
  if (t.length <= RESPONSE_HEAD_CHARS + RESPONSE_TAIL_CHARS) return t;
  return `${t.slice(0, RESPONSE_HEAD_CHARS)}\n…\n${t.slice(-RESPONSE_TAIL_CHARS)}`;
}

const MAX_ERROR_CHARS = 800;

/**
 * Tool errors: "Tool: message", with the parts that differ between otherwise
 * identical failures masked (directories, long hex ids, long numbers), so the
 * same failure in another file or run embeds close by. The file name is kept.
 */
export function prepareErrorText(tool: string, message: string): string {
  const masked = message
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.@+-]+){2,}[\\/]([\w.@+-]+)/g, "…/$1")
    .replace(/\b(?:0x)?[0-9a-f]{8,}\b/gi, "<hex>")
    .replace(/\b\d{4,}\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
  return `${tool}: ${masked}`.slice(0, MAX_ERROR_CHARS);
}

export function contentHash(prepared: string): string {
  return createHash("sha256").update(prepared).digest("hex");
}

async function embed(input: string[], timeoutMs: number): Promise<number[][] | null> {
  if (!EMBEDDING_URL || input.length === 0) return null;
  try {
    const res = await fetch(`${EMBEDDING_URL}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input, truncate: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.warn(`[embeddings] HTTP ${res.status} from Ollama`);
      return null;
    }
    const body = (await res.json()) as { embeddings?: unknown };
    const vectors = body.embeddings;
    const valid =
      Array.isArray(vectors) &&
      vectors.length === input.length &&
      vectors.every(
        (v) => Array.isArray(v) && v.length === EMBEDDING_DIM && v.every(Number.isFinite),
      );
    if (!valid) {
      console.warn("[embeddings] malformed response from Ollama");
      return null;
    }
    return vectors as number[][];
  } catch (err) {
    console.warn("[embeddings] request failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Embed already-prepared document texts. */
export function embedDocuments(
  texts: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<number[][] | null> {
  return embed(texts, timeoutMs);
}

/** Embed a search query (instruction-prefixed, short timeout for the API path). */
export async function embedQuery(text: string): Promise<number[] | null> {
  const out = await embed([QUERY_INSTRUCTION + preparePromptText(text)], QUERY_TIMEOUT_MS);
  return out?.[0] ?? null;
}

/** pgvector literal, e.g. "[0.1,0.2]". Values are validated finite numbers. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
