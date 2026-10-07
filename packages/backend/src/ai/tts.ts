/**
 * Local text-to-speech client: the homelab's speech services.
 *
 * Voices the plugin's announcements, reply summaries and explanations, so
 * users get a natural voice without installing a model. Each service speaks
 * the OpenAI-compatible `/v1/audio/speech` API. Text never leaves the box.
 *
 * TTS_SERVICES names the services in order, `name=url,name=url`: the first is
 * the default voice (Chatterbox Turbo on the Arc B580 in production), the rest
 * are fallbacks (Kokoro on the CPU). A request may name the one it wants
 * (`/devscope:voice model kokoro`); it is tried first, the others after it.
 * TTS_URL (+ TTS_FALLBACK_URL) is the unnamed older form. The GPU is shared
 * with Ollama and Chatterbox slows ~8x while both run, so every service but
 * the last gets only TTS_PRIMARY_TIMEOUT_MS. Kokoro-only fields (voice name,
 * volume_multiplier) are sent to each; Chatterbox's server ignores the name.
 *
 * Like the embeddings client, nothing here throws: it returns null on a
 * missing URL, timeout, non-200 or non-audio body from every service, and the
 * route answers 503 so the plugin falls back to a local voice.
 */

const trimUrl = (url: string | undefined) => url?.trim().replace(/\/+$/, "") || undefined;
export const SERVICE_NAME = /^[a-z0-9-]{1,32}$/;

export type TtsService = { name: string; url: string };

/** The configured speech services, default first. Read per call. */
export function ttsServices(): TtsService[] {
  const list = process.env.TTS_SERVICES;
  if (list) {
    return list.split(",").flatMap((entry) => {
      const at = entry.indexOf("=");
      const name = entry.slice(0, at).trim().toLowerCase();
      const url = trimUrl(entry.slice(at + 1));
      return at > 0 && url && SERVICE_NAME.test(name) ? [{ name, url }] : [];
    });
  }
  const primary = trimUrl(process.env.TTS_URL);
  const fallback = trimUrl(process.env.TTS_FALLBACK_URL);
  return [
    ...(primary ? [{ name: "default", url: primary }] : []),
    ...(primary && fallback ? [{ name: "fallback", url: fallback }] : []),
  ];
}

if (ttsServices().length === 0) {
  console.warn("[tts] neither TTS_SERVICES nor TTS_URL set — server voice disabled");
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
/** How long a service gets before the next one speaks instead (all but the last). */
const primaryTimeoutMs = () => Number(process.env.TTS_PRIMARY_TIMEOUT_MS ?? 10_000);

export function isTtsAvailable(): boolean {
  return ttsServices().length > 0;
}

/**
 * WAV audio for `text` from the requested service (`model`, by name) or the
 * default, else the next service in order; null when none answers. An unknown
 * name is ignored.
 */
export async function synthesize(
  text: string,
  voice: string = TTS_DEFAULTS.voice,
  speed: number = TTS_DEFAULTS.speed,
  volume: number = TTS_DEFAULTS.volume,
  model?: string,
): Promise<ArrayBuffer | null> {
  const services = ttsServices();
  const chosen = services.findIndex((s) => s.name === model);
  const order = chosen > 0 ? [services[chosen]!, ...services.filter((_, i) => i !== chosen)] : services;
  const body = JSON.stringify({
    model: TTS_MODEL,
    input: text,
    voice,
    speed,
    volume_multiplier: volume,
    response_format: "wav",
  });
  for (const [i, service] of order.entries()) {
    const last = i === order.length - 1;
    const audio = await speak(service.url, body, last ? TIMEOUT_MS : primaryTimeoutMs());
    if (audio) return audio;
    if (!last) console.warn(`[tts] ${service.name} unavailable, trying ${order[i + 1]!.name}`);
  }
  return null;
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
