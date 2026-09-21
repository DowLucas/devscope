import type { SQL } from "bun";
import { choice } from "@typesafe-ai/sdk";
import { callGemini, isAiAvailable, TEMPERATURE } from "../ai/gemini";
import {
  askSystemOne,
  isTypeSafeAvailable,
  CONFIDENCE,
} from "../ai/typesafe";
import { recordTokenUsage } from "../db/aiQueries";
import { inList } from "../db/utils";

const CHECK_INTERVAL_MS = 60_000;
const RUN_EVERY_MS = 60 * 60 * 1000; // hourly
const BATCH_SIZE = 50;
// Don't classify sessions older than this (cap blast radius and cost)
const MAX_AGE_DAYS = 30;

/**
 * Intent buckets, as TypeSafe Choice criteria: label -> description.
 *
 * This object is the single source of truth. The Gemini fallback prompt is
 * generated from it, so the two paths cannot drift apart.
 */
const INTENT_CRITERIA = {
  debug: "fixing a specific bug, investigating an error, reproducing a failure",
  build: "implementing new functionality or features",
  refactor: "restructuring existing code without changing behavior",
  doc: "writing or editing documentation, comments, READMEs",
  review: "reviewing a PR or diff, providing feedback",
  exploration: "reading/searching/learning the codebase, no clear write goal",
  tooling: "configuring CI, build setup, dev environment, scripts",
  other: "none of the above fit",
} as const;

type Intent = keyof typeof INTENT_CRITERIA;

const VALID_INTENTS = new Set<string>(Object.keys(INTENT_CRITERIA));

/**
 * Batch budget. Every question is evaluated in parallel against one state, so
 * this is a single request regardless of batch size, but it still has to fit
 * the 64k context (state + all questions).
 */
const TYPESAFE_TIMEOUT_MS = 30_000;

const CLASSIFICATION_PROMPT = `You classify Claude Code coding sessions into one of these intent buckets:

${Object.entries(INTENT_CRITERIA)
  .map(([k, v]) => `- "${k}": ${v}`)
  .join("\n")}

Rules:
- Reply with ONLY a JSON array, no prose, no code fences.
- Format: [{"id":"<session_id>","intent":"<bucket>"}, ...]
- One entry per session, exact id match.
- Never mention developers by name. Never compare sessions. Never rank.

Sessions:
`;

interface SessionRow {
  id: string;
  title: string | null;
  duration_min: number;
  prompt_count: number;
  top_tools: string;
  project_name: string | null;
}

async function fetchSessionSummaries(sql: SQL): Promise<SessionRow[]> {
  return (await sql`
    SELECT
      s.id,
      s.session_title as title,
      s.project_name,
      ROUND(EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60)::INT as duration_min,
      (
        SELECT COUNT(*)::INT FROM events e
        WHERE e.session_id = s.id AND e.event_type = 'prompt.submit'
      ) as prompt_count,
      (
        SELECT STRING_AGG(tool_name, ',' ORDER BY n DESC)
        FROM (
          SELECT e2.payload->>'toolName' as tool_name, COUNT(*) as n
          FROM events e2
          WHERE e2.session_id = s.id
            AND e2.event_type IN ('tool.complete', 'tool.fail')
            AND e2.payload->>'toolName' IS NOT NULL
          GROUP BY tool_name
          ORDER BY n DESC
          LIMIT 5
        ) t
      ) as top_tools
    FROM sessions s
    WHERE s.session_intent IS NULL
      AND s.ended_at IS NOT NULL
      AND s.ended_at >= NOW() - make_interval(days => ${MAX_AGE_DAYS})
    ORDER BY s.ended_at DESC
    LIMIT ${BATCH_SIZE}`) as SessionRow[];
}

/** One classified session. `confidence` is null on the Gemini fallback path. */
interface ClassificationResult {
  id: string;
  intent: Intent;
  confidence: number | null;
}

/** Structured per-session summary used as TypeSafe `state`. */
function toStateEntry(row: SessionRow, index: number) {
  return {
    ref: `s${index}`,
    title: row.title?.slice(0, 120) ?? null,
    project: row.project_name?.slice(0, 60) ?? null,
    duration_minutes: row.duration_min,
    prompt_count: row.prompt_count,
    top_tools: row.top_tools ? row.top_tools.split(",") : [],
  };
}

/**
 * Classify via TypeSafe System One using speculative fan-out: every session in
 * the batch becomes its own Choice question against one shared state, answered
 * in parallel and in isolation. One request, no JSON parsing, and the answer is
 * constrained to the bucket labels by construction.
 *
 * Returns null if TypeSafe is unavailable or the call fails, so the caller can
 * fall back to Gemini.
 */
async function classifyWithTypeSafe(
  sql: SQL,
  rows: SessionRow[],
): Promise<ClassificationResult[] | null> {
  if (!isTypeSafeAvailable()) return null;

  const state = rows.map(toStateEntry);

  const questions: Record<string, ReturnType<typeof choice>> = {};
  for (let i = 0; i < rows.length; i++) {
    questions[`s${i}`] = choice(
      `Which intent bucket best describes the coding session with ref "s${i}"? Judge only that session.`,
      INTENT_CRITERIA,
    );
  }

  const result = await askSystemOne(state, questions, {
    timeoutMs: TYPESAFE_TIMEOUT_MS,
    feature: "session-intent",
    sql,
  });
  if (!result) return null;

  const out: ClassificationResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const answer = result.answers[`s${i}`];
    if (!answer || answer.type !== "choice") continue;
    if (!VALID_INTENTS.has(answer.choice)) continue;
    out.push({
      id: rows[i]!.id,
      intent: answer.choice as Intent,
      confidence: answer.confidence,
    });
  }
  return out;
}

function buildPrompt(rows: SessionRow[]): string {
  const lines = rows.map((r) => {
    const parts = [
      `id=${r.id}`,
      r.title ? `title="${r.title.replace(/"/g, "'").slice(0, 80)}"` : null,
      r.project_name ? `project=${r.project_name.slice(0, 40)}` : null,
      `duration=${r.duration_min}m`,
      `prompts=${r.prompt_count}`,
      r.top_tools ? `tools=[${r.top_tools}]` : null,
    ].filter(Boolean);
    return `- ${parts.join(" ")}`;
  });
  return CLASSIFICATION_PROMPT + lines.join("\n");
}

function parseResponse(text: string): ClassificationResult[] {
  const cleaned = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is { id: string; intent: Intent } =>
          r &&
          typeof r.id === "string" &&
          typeof r.intent === "string" &&
          VALID_INTENTS.has(r.intent),
      )
      .map((r) => ({ id: r.id, intent: r.intent, confidence: null }));
  } catch {
    return [];
  }
}

/** Gemini fallback: free-text JSON that has to be parsed and re-validated. */
async function classifyWithGemini(
  sql: SQL,
  rows: SessionRow[],
): Promise<ClassificationResult[] | null> {
  if (!isAiAvailable()) return null;

  const response = await callGemini(
    [{ role: "user", parts: [{ text: buildPrompt(rows) }] }],
    undefined,
    { temperature: TEMPERATURE.query },
  );

  const results = parseResponse(response.text);

  await recordTokenUsage(
    sql,
    "session-intent",
    "gemini-flash",
    response.inputTokens,
    response.outputTokens,
  );

  return results;
}

async function persist(sql: SQL, results: ClassificationResult[]): Promise<void> {
  // Rows carrying a confidence are written individually so the score lands with
  // the bucket. Rows without one (Gemini fallback) are grouped per intent, as
  // before, to keep that path cheap.
  const withConfidence = results.filter((r) => r.confidence !== null);
  const withoutConfidence = results.filter((r) => r.confidence === null);

  for (const r of withConfidence) {
    await sql`
      UPDATE sessions
      SET session_intent = ${r.intent},
          session_intent_confidence = ${r.confidence}
      WHERE id = ${r.id} AND session_intent IS NULL`;
  }

  const byIntent = new Map<string, string[]>();
  for (const r of withoutConfidence) {
    if (!byIntent.has(r.intent)) byIntent.set(r.intent, []);
    byIntent.get(r.intent)!.push(r.id);
  }
  for (const [intent, ids] of byIntent) {
    await sql`
      UPDATE sessions SET session_intent = ${intent}
      WHERE id IN (${inList(ids)}) AND session_intent IS NULL`;
  }
}

async function runOnce(sql: SQL): Promise<void> {
  const rows = await fetchSessionSummaries(sql);
  if (rows.length === 0) return;

  console.log(`[session-intent] Classifying ${rows.length} sessions`);

  let results = await classifyWithTypeSafe(sql, rows);
  let via = "typesafe";

  if (results === null) {
    results = await classifyWithGemini(sql, rows);
    via = "gemini";
  }

  if (results === null) {
    console.warn("[session-intent] No classifier available — skipping batch");
    return;
  }
  if (results.length === 0) {
    console.warn(`[session-intent] ${via} returned no usable classifications`);
    return;
  }

  await persist(sql, results);

  const lowConfidence = results.filter(
    (r) => r.confidence !== null && r.confidence < CONFIDENCE.floor,
  ).length;

  console.log(
    `[session-intent] Classified ${results.length}/${rows.length} sessions via ${via}` +
      (lowConfidence > 0 ? ` (${lowConfidence} below confidence floor)` : ""),
  );
}

export function startSessionIntentClassification(sql: SQL) {
  const g = globalThis as any;
  if (g.__gc_session_intent_interval) clearInterval(g.__gc_session_intent_interval);

  if (!isTypeSafeAvailable() && !isAiAvailable()) {
    console.log(
      "[session-intent] Skipped — neither TYPESAFE_API_KEY nor GEMINI_API_KEY set",
    );
    return;
  }

  let lastRunMs = 0;

  async function check() {
    const now = Date.now();
    if (now - lastRunMs < RUN_EVERY_MS) return;
    lastRunMs = now;
    try {
      await runOnce(sql);
    } catch (err) {
      console.error("[session-intent] Failed:", err);
    }
  }

  // Kick off shortly after boot, then hourly
  setTimeout(() => void check(), 30_000);
  g.__gc_session_intent_interval = setInterval(check, CHECK_INTERVAL_MS);
  console.log(`[session-intent] Scheduled hourly`);
}

// Test-only exports
export const __test = { toStateEntry, parseResponse, INTENT_CRITERIA, persist };
