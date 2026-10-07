/**
 * Local text-to-speech client (Kokoro-FastAPI on the homelab).
 *
 * Voices the plugin's "a session needs you" announcements, so users get a
 * natural voice without installing a model. The service speaks the
 * OpenAI-compatible `/v1/audio/speech` API. Text never leaves the box.
 *
 * Like the embeddings client, nothing here throws: it returns null on a
 * missing URL, timeout, non-200 or non-audio body, and the route answers 503
 * so the plugin falls back to a local voice.
 */

const TTS_URL = process.env.TTS_URL?.replace(/\/+$/, "");
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

export function isTtsAvailable(): boolean {
  return !!TTS_URL;
}

/** WAV audio for `text`, or null when the service is unavailable. */
export async function synthesize(
  text: string,
  voice: string = TTS_DEFAULTS.voice,
  speed: number = TTS_DEFAULTS.speed,
  volume: number = TTS_DEFAULTS.volume,
): Promise<ArrayBuffer | null> {
  if (!TTS_URL) return null;
  try {
    const res = await fetch(`${TTS_URL}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: text,
        voice,
        speed,
        volume_multiplier: volume,
        response_format: "wav",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[tts] HTTP ${res.status} from TTS service`);
      return null;
    }
    if (!res.headers.get("content-type")?.startsWith("audio/")) {
      console.warn("[tts] non-audio response from TTS service");
      return null;
    }
    const audio = await res.arrayBuffer();
    return audio.byteLength > 0 ? audio : null;
  } catch (err) {
    console.warn("[tts] request failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
