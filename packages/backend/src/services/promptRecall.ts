import type { SimilarTurnRow } from "../db";

/**
 * "You've asked this before": recall for the plugin's UserPromptSubmit hook.
 *
 * Gated retrieval: only near-duplicates (document-to-document cosine >= 0.9,
 * the same scale the déjà-vu analysis measured a ~6% repeat rate on) from an
 * earlier session count, and nothing is returned for short prompts such as
 * "yes" or "continue". The result is a compact note for Claude's context.
 */
export const RECALL = {
  minSimilarity: 0.9,
  minWords: 4,
  /** Candidates fetched before thresholding; also bounds the repeat-day count. */
  lookback: 10,
  maxShown: 3,
  /** Turns newer than this are the current stretch of work, not "before". */
  recentHours: 2,
  /** The hook blocks prompt submission, so embedding gets a tight budget. */
  embedTimeoutMs: 1_200,
  maxChars: 900,
  /** Distinct days after which the note suggests making it a skill. */
  skillAfterDays: 3,
} as const;

export interface RecallMatch {
  day: string;
  similarity: number;
  prompt: string;
  sessionTitle: string | null;
  toolCalls: number;
  toolFailures: number;
  ended: string | null;
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const dayOf = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Strong matches, best first, at most one per day (the same ask twice in a
 * day is one occurrence), plus how many distinct days it came up on.
 */
export function selectMatches(rows: SimilarTurnRow[]): { matches: RecallMatch[]; repeatDays: number } {
  const hits = rows.filter((r) => r.similarity >= RECALL.minSimilarity);
  const byDay = new Map<string, SimilarTurnRow>();
  for (const r of hits) {
    const d = dayOf(r.prompt_at);
    const cur = byDay.get(d);
    if (!cur || r.similarity > cur.similarity) byDay.set(d, r);
  }
  const matches = [...byDay.entries()]
    .sort((a, b) => b[1].similarity - a[1].similarity)
    .slice(0, RECALL.maxShown)
    .map(([day, r]) => ({
      day,
      similarity: Math.round(r.similarity * 100) / 100,
      prompt: clip(r.prompt_text, 120),
      sessionTitle: r.session_title ? clip(r.session_title, 60) : null,
      toolCalls: r.tool_calls,
      toolFailures: r.tool_failures,
      ended: r.response_tail ? clip(r.response_tail, 160) : null,
    }));
  return { matches, repeatDays: byDay.size };
}

/** The note injected into Claude's context, capped at RECALL.maxChars. */
export function formatRecall(matches: RecallMatch[], repeatDays: number): string | null {
  if (matches.length === 0) return null;
  const line = (m: RecallMatch) => {
    const where = m.sessionTitle ? `session "${m.sessionTitle}", ` : "";
    const fails = m.toolFailures ? `, ${m.toolFailures} failed` : ", none failed";
    const ended = m.ended ? ` Ended: "${m.ended}"` : "";
    return `• ${m.day} (${m.similarity.toFixed(2)}): "${m.prompt}" (${where}${m.toolCalls} tool calls${fails}).${ended}`;
  };
  const compose = (n: number) => [
    "DevScope: the user has asked something very similar before:",
    ...matches.slice(0, n).map(line),
    ...(repeatDays >= RECALL.skillAfterDays
      ? [`This has come up on ${repeatDays} separate days; if it fits, suggest turning it into a skill or a CLAUDE.md rule.`]
      : []),
    "Reuse what worked and avoid what failed. Mention this only if it helps.",
  ].join("\n");
  // Drop the weakest matches until it fits; clip as a last resort.
  for (let n = matches.length; n >= 1; n--) {
    const out = compose(n);
    if (out.length <= RECALL.maxChars) return out;
  }
  return `${compose(1).slice(0, RECALL.maxChars - 1)}…`;
}
