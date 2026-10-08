import type { SQL } from "bun";
import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { callGemini, DEFAULT_MODEL } from "../ai/gemini";
import { isTtsAvailable, synthesize, ttsServices } from "../ai/tts";
import { speakable } from "../services/speakable";
import { recordTokenUsage } from "../db";
import {
  VOICE,
  buildVoicePrompt,
  sessionLabel,
  sessionTopic,
  spokenLimits,
  toSpokenText,
  voiceAudioBody,
  voiceThinkingBudget,
  voiceSummaryBody,
  withLabel,
  type VoiceSummaryInput,
} from "../services/voiceSummary";
import { getOwnOrgDevIds } from "../services/visibility";
import { checkRateLimit, rateLimitKey, requireAi } from "./aiGuards";

/**
 * The plugin's voice features, mounted under /api/ai: a sentence saying which
 * session needs the user, or a short summary of Claude's reply (Gemini), and
 * text as audio (the homelab TTS service). Stateless: nothing is persisted
 * beyond token usage.
 */
export function voiceRoutes(sql: SQL) {
  const app = new Hono();

  app.post("/voice-summary", requireAi(sql), zValidator("json", voiceSummaryBody), async (c) => {
    const orgId = c.get("orgId" as never) as string | undefined;
    const input = c.req.valid("json");
    const label = await resolveLabel(sql, c, input);
    let result;
    try {
      result = await callGemini(buildVoicePrompt(input, label != null), undefined, {
        temperature: VOICE.temperature,
        maxOutputTokens: VOICE.maxOutputTokens,
        thinkingBudget: voiceThinkingBudget(DEFAULT_MODEL),
      });
    } catch (err) {
      console.error("[ai] voice summary failed:", err);
      return c.json({ error: "Summary unavailable" }, 502);
    }
    // Usage accounting must not cost the user their summary.
    recordTokenUsage(sql, "voice_summary", DEFAULT_MODEL, result.inputTokens, result.outputTokens, orgId).catch(
      (err) => console.error("[ai] voice usage not recorded:", err),
    );
    // Cap the model's own words first; speakable() then adds words ("5s" ->
    // "5 seconds") that must not count against the cap and chop the summary.
    const capped = toSpokenText(result.text, spokenLimits(input.trigger, input.length));
    if (!capped) return c.json({ error: "Empty summary" }, 502);
    const labelled = withLabel(label, capped);
    const spoken = speakable(labelled);
    // An announcement is voiced in one request (at most maxChars * 2); a reply
    // summary is voiced in pieces, so only announcements need the guard.
    const text = input.trigger !== "reply" && spoken.length > VOICE.maxChars * 2 ? labelled : spoken;
    return c.json(label ? { text, label } : { text });
  });

  // No Gemini here, so its own rate-limit bucket and no token budget.
  app.post("/voice-audio", zValidator("json", voiceAudioBody), async (c) => {
    if (!isTtsAvailable()) return c.json({ error: "Server voice unavailable: TTS_URL not configured" }, 503);
    if (!checkRateLimit(`tts:${rateLimitKey(c)}`)) {
      return c.json({ error: "Rate limit exceeded. Max 20 voice requests/minute." }, 429);
    }
    const { text, voice, speed, volume, model } = c.req.valid("json");
    // Every voiced text, Claude's explanations included, is said the way a person would say it.
    const audio = await synthesize(speakable(text), voice, speed, volume, model);
    if (!audio) return c.json({ error: "Voice unavailable" }, 503);
    return new Response(audio, { headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
  });

  // The voices this server offers, default first, for `/devscope:voice model`.
  app.get("/voice-models", (c) => c.json({ models: ttsServices().map((s) => s.name) }));

  return app;
}

/**
 * The session's spoken name: the one the plugin got earlier (so it never
 * changes mid-session), else project plus what the caller's own session is
 * working on. Null for older plugins that send no session, so they keep the
 * old wording. A lookup failure only costs the topic, never the summary.
 */
async function resolveLabel(sql: SQL, c: Context, input: VoiceSummaryInput): Promise<string | null> {
  if (input.label) return input.label;
  if (!input.session_id) return null;
  let topic: string | null = null;
  try {
    const own = new Set(await getOwnOrgDevIds(sql, c as never));
    const [row] = await sql`
      SELECT developer_id, current_title, git_branch, privacy_mode
      FROM sessions WHERE id = ${input.session_id}`;
    if (row && own.has(row.developer_id)) topic = sessionTopic(row);
  } catch (err) {
    console.error("[ai] voice label lookup failed:", err);
  }
  return sessionLabel(input.project, topic);
}
