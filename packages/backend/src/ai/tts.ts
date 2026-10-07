/**
 * Local text-to-speech client: the homelab's speech services.
 *
 * Voices the plugin's announcements, reply summaries and explanations, so
 * users get a natural voice without installing a model. Each service speaks
 * the OpenAI-compatible `/v1/audio/speech` API. Text never leaves the box.
 *
 * TTS_URL is the voice (Chatterbox Turbo on the Arc B580 in production);
 * TTS_FALLBACK_URL, when set, is tried when it fails or answers too slowly
 * (Kokoro on the CPU). The GPU is shared with Ollama and Chatterbox slows ~8x
 * while both run, so with a fallback the first service gets only
 * TTS_PRIMARY_TIMEOUT_MS. Kokoro-only fields (voice name, volume_multiplier)
 * are sent to both; Chatterbox's server ignores the voice name.
 *
 * Like the embeddings client, nothing here throws: it returns null on a
 * missing URL, timeout, non-200 or non-audio body from every service, and the
 * route answers 503 so the plugin falls back to a local voice.
 */

const trimUrl = (url: string | undefined) => url?.replace(/\/+$/, "") || undefined;
const TTS_URL = trimUrl(process.env.TTS_URL);
// Read per call, so the fallback can be configured without a code path at import.
const fallbackUrl = () => trimUrl(process.env.TTS_FALLBACK_URL);
if (!TTS_URL) {
  console.warn("[tts] TTS_URL not set — server voice disabled");
}

export const TTS_MODEL = process.env.TTS_MODEL ?? "kokoro";

export const TTS_DEFAULTS = {
  voice: process.env.TTS_VOICE ?? "am_michael",
  speed: Number(process.env.TTS_SPEED ?? 1.2),
  // Kokoro's volume_multiplier raises loudness while keeping peaks limited;
  // at 2.0 the voice is twice as loud as default with no clipping.
  volume: Number(process.env.TTS_VOLUME ?? 2),
} as const;

const TIMEOUT_MS = 15_000;
/** How long the voice gets before the fallback speaks instead (only when there is one). */
const primaryTimeoutMs = () => Number(process.env.TTS_PRIMARY_TIMEOUT_MS ?? 10_000);

export function isTtsAvailable(): boolean {
  return !!TTS_URL;
}

/** WAV audio for `text` from the voice, else the fallback; null when neither answers. */
export async function synthesize(
  text: string,
  voice: string = TTS_DEFAULTS.voice,
  speed: number = TTS_DEFAULTS.speed,
  volume: number = TTS_DEFAULTS.volume,
): Promise<ArrayBuffer | null> {
  if (!TTS_URL) return null;
  const body = JSON.stringify({
    model: TTS_MODEL,
    input: text,
    voice,
    speed,
    volume_multiplier: volume,
    response_format: "wav",
  });
  const fallback = fallbackUrl();
  const audio = await speak(TTS_URL, body, fallback ? primaryTimeoutMs() : TIMEOUT_MS);
  if (audio || !fallback) return audio;
  console.warn("[tts] voice unavailable, using the fallback");
  return speak(fallback, body, TIMEOUT_MS);
}

async function speak(url: string, body: string, timeoutMs: number): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`${url}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.warn(`[tts] HTTP ${res.status} from ${url}`);
      return null;
    }
    if (!res.headers.get("content-type")?.startsWith("audio/")) {
      console.warn(`[tts] non-audio response from ${url}`);
      return null;
    }
    const audio = await res.arrayBuffer();
    return audio.byteLength > 0 ? audio : null;
  } catch (err) {
    console.warn(`[tts] request to ${url} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
