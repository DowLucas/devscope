import { callGemini, isAiAvailable, TEMPERATURE } from "../gemini";

// Phrases a 1–2 sentence nudge for the live Claude Code session when an
// anti-pattern trips. Decision is rules-based; this only controls the wording.
//
// Aggressive caching by (rule_type, tool_signature) keeps Gemini calls rare:
// the same loop pattern (e.g. "repeated Bash failure") is phrased once and
// reused for 5 minutes. Falls back to a static template if Gemini is slow
// or unavailable, so the hook latency budget is bounded.

interface CachedNudge {
  message: string;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const cache: Map<string, CachedNudge> = ((globalThis as any).__nudgeCache ??=
  new Map<string, CachedNudge>());

const PHRASING_TIMEOUT_MS = 800;

export interface NudgeInput {
  ruleType: string; // e.g. "repeated_failure", "failure_cascade"
  toolName: string;
  failureCount: number;
  staticSuggestion: string;
}

function templateFallback(input: NudgeInput): string {
  if (input.ruleType === "repeated_failure") {
    return `DevScope: ${input.toolName} has failed ${input.failureCount} times in a row. ${input.staticSuggestion}`;
  }
  if (input.ruleType === "failure_cascade") {
    return `DevScope: cascading failures across multiple tools. ${input.staticSuggestion}`;
  }
  return `DevScope: ${input.staticSuggestion}`;
}

export async function phraseNudge(input: NudgeInput): Promise<string> {
  const cacheKey = `${input.ruleType}|${input.toolName}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.message;

  if (!isAiAvailable()) {
    const msg = templateFallback(input);
    cache.set(cacheKey, { message: msg, expiresAt: now + TTL_MS });
    return msg;
  }

  const prompt = `You are a coaching layer for a Claude Code session that just hit a friction signal.

Signal:
- rule: ${input.ruleType}
- tool: ${input.toolName}
- consecutive failures: ${input.failureCount}
- suggested approach (you may rephrase): ${input.staticSuggestion}

Write ONE message, 1–2 short sentences, addressed to the AI agent (not the human). Be concrete and direct: name what is happening and the next step it should try (rephrasing, breaking down the task, switching tool, gathering context). Do not include any developer names or rankings. Do not start with "I". Do not use markdown. Do not exceed 240 characters.`;

  const phrasingPromise = callGemini(
    [{ role: "user", parts: [{ text: prompt }] }],
    undefined,
    { temperature: TEMPERATURE.insight, maxOutputTokens: 120 },
  );

  let text: string;
  try {
    const result = await Promise.race([
      phrasingPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), PHRASING_TIMEOUT_MS)),
    ]);
    if (!result) {
      text = templateFallback(input);
    } else {
      text = result.text.trim().slice(0, 280) || templateFallback(input);
    }
  } catch {
    text = templateFallback(input);
  }

  if (!text.toLowerCase().includes("devscope")) text = `DevScope: ${text}`;

  cache.set(cacheKey, { message: text, expiresAt: now + TTL_MS });
  return text;
}

// Test-only
export function __resetNudgeCache(): void {
  cache.clear();
}
