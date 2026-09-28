import type { SQL } from "bun";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { callGemini, DEFAULT_MODEL } from "../ai/gemini";
import { isTtsAvailable, synthesize } from "../ai/tts";
import { recordTokenUsage } from "../db";
import { VOICE, buildVoicePrompt, toSpokenText, voiceAudioBody, voiceSummaryBody } from "../services/voiceSummary";
import { checkRateLimit, rateLimitKey, requireAi } from "./aiGuards";

/**
 * The plugin's voice announcer, mounted under /api/ai: a sentence saying which
 * session needs the user (Gemini), and that sentence as audio (the homelab
 * TTS service). Stateless: nothing is persisted beyond token usage.
 */
export function voiceRoutes(sql: SQL) {
  const app = new Hono();

  app.post("/voice-summary", requireAi(sql), zValidator("json", voiceSummaryBody), async (c) => {
    const orgId = c.get("orgId" as never) as string | undefined;
    let result;
    try {
      result = await callGemini(buildVoicePrompt(c.req.valid("json")), undefined, {
        temperature: VOICE.temperature,
        maxOutputTokens: VOICE.maxOutputTokens,
      });
    } catch (err) {
      console.error("[ai] voice summary failed:", err);
      return c.json({ error: "Summary unavailable" }, 502);
    }
    // Usage accounting must not cost the user their summary.
    recordTokenUsage(sql, "voice_summary", DEFAULT_MODEL, result.inputTokens, result.outputTokens, orgId).catch(
      (err) => console.error("[ai] voice usage not recorded:", err),
    );
    const text = toSpokenText(result.text);
    if (!text) return c.json({ error: "Empty summary" }, 502);
    return c.json({ text });
  });

  // No Gemini here, so its own rate-limit bucket and no token budget.
  app.post("/voice-audio", zValidator("json", voiceAudioBody), async (c) => {
    if (!isTtsAvailable()) return c.json({ error: "Server voice unavailable: TTS_URL not configured" }, 503);
    if (!checkRateLimit(`tts:${rateLimitKey(c)}`)) {
      return c.json({ error: "Rate limit exceeded. Max 20 voice requests/minute." }, 429);
    }
    const { text, voice, speed } = c.req.valid("json");
    const audio = await synthesize(text, voice, speed);
    if (!audio) return c.json({ error: "Voice unavailable" }, 503);
    return new Response(audio, { headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
  });

  return app;
}
