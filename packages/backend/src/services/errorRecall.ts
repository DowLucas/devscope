import type { SimilarErrorRow } from "../db";
import { clip, dayOf, fitToCap } from "./promptRecall";

/**
 * "This error came up before": recall for the plugin's PostToolUseFailure
 * hook. Nearest past failures from the caller's own earlier sessions, with
 * whether the same tool went on to succeed and how Claude's reply ended, so
 * Claude can reuse the fix instead of rediscovering it.
 */
export const ERROR_RECALL = {
  // Provisional: to be calibrated on prod error embeddings after the backfill.
  // Too low and matches share only a tool and a vague shape, not the cause.
  minSimilarity: 0.88,
  lookback: 10,
  maxShown: 3,
  /** The hook blocks Claude's next step, so embedding gets a tight budget. */
  embedTimeoutMs: 1_200,
  maxChars: 900,
} as const;

export interface ErrorMatch {
  day: string;
  similarity: number;
  error: string;
  sessionTitle: string | null;
  resolved: boolean;
  ended: string | null;
}

/**
 * Strong matches, one per session (a loop of the same failure is one
 * occurrence), resolved ones first since those carry a fix.
 */
export function selectErrorMatches(rows: SimilarErrorRow[]): ErrorMatch[] {
  const bySession = new Map<string, SimilarErrorRow>();
  for (const r of rows) {
    if (r.similarity < ERROR_RECALL.minSimilarity) continue;
    const cur = bySession.get(r.session_id);
    if (!cur || r.similarity > cur.similarity) bySession.set(r.session_id, r);
  }
  return [...bySession.values()]
    .sort((a, b) => Number(b.resolved) - Number(a.resolved) || b.similarity - a.similarity)
    .slice(0, ERROR_RECALL.maxShown)
    .map((r) => ({
      day: dayOf(r.created_at),
      similarity: Math.round(r.similarity * 100) / 100,
      error: clip(r.message, 140),
      sessionTitle: r.session_title ? clip(r.session_title, 60) : null,
      resolved: r.resolved,
      ended: r.response_tail ? clip(r.response_tail, 180) : null,
    }));
}

/** The note injected into Claude's context, capped at ERROR_RECALL.maxChars. */
export function formatErrorRecall(matches: ErrorMatch[]): string | null {
  if (matches.length === 0) return null;
  const line = (m: ErrorMatch) => {
    const where = m.sessionTitle ? ` in "${m.sessionTitle}"` : "";
    const outcome = m.resolved ? "resolved shortly after" : "not resolved soon after";
    const ended = m.ended ? ` That turn ended: "${m.ended}"` : "";
    return `• ${m.day}${where} (${m.similarity.toFixed(2)}): "${m.error}", ${outcome}.${ended}`;
  };
  const compose = (n: number) =>
    [
      "DevScope: the user has hit a very similar error before:",
      ...matches.slice(0, n).map(line),
      "If one of these was resolved, try that fix first. Mention this only if it helps.",
    ].join("\n");
  return fitToCap(compose, matches.length, ERROR_RECALL.maxChars);
}
