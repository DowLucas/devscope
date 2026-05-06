/**
 * Runtime LLM grounding check (DEV-30 / M2).
 *
 * AI surfaces (chat, insights, reports) are prompt-guarded to refuse per-developer
 * output, but prompt guards are advisory: a model can drift or be coaxed into
 * surfacing a developer name or per-dev breakdown. This module verifies model
 * output AFTER generation and either redacts the offending fragments or replaces
 * the response with a generic team-aggregated fallback.
 *
 * Mission: DevScope provides team-visibility, not individual surveillance.
 * If a name leaks, we catch it.
 */

import type { SQL } from "bun";
import { logEthicsEvent } from "../../utils/ethicsAudit";

/** Roster-cache TTL: short enough to pick up new developers, long enough to avoid
 *  re-querying for every LLM call during a burst. */
const ROSTER_CACHE_TTL_MS = 5 * 60_000;

/** Names shorter than this are skipped (too many false positives — e.g. "Al", "Bo"). */
const MIN_NAME_LENGTH = 3;

/**
 * Set of common English words / generic tokens that should never be treated as
 * a developer name even if a developer has that as their display name. Without
 * this filter "Test User", "Admin", "Developer" would constantly trip the check.
 */
const NAME_STOPLIST = new Set([
  "test",
  "admin",
  "developer",
  "developers",
  "user",
  "team",
  "demo",
  "guest",
  "anonymous",
  "unknown",
  "null",
  "none",
]);

interface RosterEntry {
  /** Lowercased token form used for matching. */
  needle: string;
  /** Original casing for telemetry. */
  display: string;
  kind: "name" | "email";
  developerId: string;
}

interface CachedRoster {
  fetchedAt: number;
  entries: RosterEntry[];
}

let cachedRoster: CachedRoster | null = null;

/** Reset the in-memory roster cache. Used by tests. */
export function _resetRosterCache() {
  cachedRoster = null;
}

async function loadRoster(sql: SQL): Promise<RosterEntry[]> {
  const now = Date.now();
  if (cachedRoster && now - cachedRoster.fetchedAt < ROSTER_CACHE_TTL_MS) {
    return cachedRoster.entries;
  }

  const rows = (await sql`
    SELECT id, name, email
    FROM developers
  `) as Array<{ id: string; name: string | null; email: string | null }>;

  const entries: RosterEntry[] = [];
  for (const row of rows) {
    if (row.name) {
      const trimmed = row.name.trim();
      const tokens = trimmed.split(/\s+/).filter(Boolean);
      // Skip the entire entry if every individual token is stoplisted (e.g.
      // "Test User", "Demo Developer") — these display names are noise that
      // would generate false positives across normal English prose.
      const allStoplisted =
        tokens.length > 0 &&
        tokens.every((t) => NAME_STOPLIST.has(t.toLowerCase()));
      if (
        !allStoplisted &&
        trimmed.length >= MIN_NAME_LENGTH &&
        !NAME_STOPLIST.has(trimmed.toLowerCase())
      ) {
        entries.push({
          needle: trimmed.toLowerCase(),
          display: trimmed,
          kind: "name",
          developerId: row.id,
        });
        // Also add each name token (first/last) so "Alice" matches even when the
        // roster stores "Alice Doe". Skip stoplisted/short tokens.
        for (const tok of trimmed.split(/\s+/)) {
          if (
            tok.length >= MIN_NAME_LENGTH &&
            !NAME_STOPLIST.has(tok.toLowerCase()) &&
            tok.toLowerCase() !== trimmed.toLowerCase()
          ) {
            entries.push({
              needle: tok.toLowerCase(),
              display: tok,
              kind: "name",
              developerId: row.id,
            });
          }
        }
      }
    }
    if (row.email) {
      const trimmed = row.email.trim();
      if (trimmed.length >= MIN_NAME_LENGTH) {
        entries.push({
          needle: trimmed.toLowerCase(),
          display: trimmed,
          kind: "email",
          developerId: row.id,
        });
      }
    }
  }

  cachedRoster = { fetchedAt: now, entries };
  return entries;
}

export type GroundingAction = "allow" | "redact" | "reject";

export interface GroundingHit {
  kind: "name" | "email" | "per_dev_shape";
  match: string;
  developerId?: string;
}

export interface GroundingResult {
  action: GroundingAction;
  /** Sanitised text. On "reject" this is the team-aggregated fallback. */
  text: string;
  hits: GroundingHit[];
}

export interface ValidateOptions {
  /** AI surface name for telemetry: "chat" | "insights" | "reports" | etc. */
  surface: string;
  /** Org id to attribute the audit event to. May be null for cross-org calls. */
  orgId?: string | null;
  /** Override fallback message (e.g. for reports vs short chat answers). */
  fallback?: string;
}

const DEFAULT_FALLBACK =
  "This response was suppressed because it appeared to reference an individual developer. " +
  "DevScope only surfaces team-level metrics — please rephrase your question in team terms " +
  "(for example: \"how is the team's failure rate trending?\").";

/**
 * Detect "developer-X-did-Y" or per-dev breakdown shapes that should never appear
 * in a team-level surface, even if no roster name is present (drift can also
 * surface synthetic names or pseudonyms the model invented).
 */
function detectPerDevShape(text: string): GroundingHit[] {
  const hits: GroundingHit[] = [];

  // Pattern 1: bullet list where every line starts with a Capitalised name
  // followed by a number. Catches drift like:
  //   - Alice: 12 sessions
  //   - Bob — 9 sessions
  //   * Carol  3 PRs
  const lines = text.split(/\r?\n/);
  let nameNumberLines = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // bullet/number prefix optional
    const stripped = line.replace(/^([-*\u2022]|\d+\.)\s+/, "");
    // "Capitalised(?: Capitalised)? <sep> number"
    if (
      /^[A-Z][a-zA-Z'’\-]{2,}(?:\s+[A-Z][a-zA-Z'’\-]{2,}){0,2}\s*[:\-—–]\s*\d/.test(
        stripped
      ) ||
      /^[A-Z][a-zA-Z'’\-]{2,}(?:\s+[A-Z][a-zA-Z'’\-]{2,}){0,2}\s+\d+\s+(sessions?|prs?|commits?|tool calls?|events?|hours?)/i.test(
        stripped
      )
    ) {
      nameNumberLines++;
    }
  }
  if (nameNumberLines >= 2) {
    hits.push({
      kind: "per_dev_shape",
      match: `per-dev breakdown shape (${nameNumberLines} lines)`,
    });
  }

  // Pattern 2: sentence shape "<Capitalised name> did/has/completed/wrote/spent <number>"
  // Catches "Alice completed 12 sessions" even when Alice is not in the roster.
  const sentenceRe =
    /\b([A-Z][a-zA-Z'’\-]{2,})\s+(?:completed|did|has|had|wrote|spent|ran|made|finished|opened|closed|reviewed)\s+\d/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = sentenceRe.exec(text)) !== null) {
    const name = m[1];
    // Skip common sentence-starts that are clearly not names.
    const lower = name.toLowerCase();
    if (NAME_STOPLIST.has(lower)) continue;
    if (
      [
        "the",
        "this",
        "that",
        "they",
        "their",
        "these",
        "those",
        "team",
        "everyone",
        "anyone",
        "someone",
        "nobody",
        "claude",
        "gemini",
      ].includes(lower)
    )
      continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    hits.push({ kind: "per_dev_shape", match: `${name} <verb> <number>` });
  }

  return hits;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Redact a single needle from text using word-boundary matching where it makes
 * sense. Returns null if no replacement happened.
 */
function redactNeedle(
  text: string,
  needle: string,
  kind: "name" | "email"
): string {
  // Names: word-boundary, case-insensitive. Emails: literal substring (boundary
  // doesn't behave well with @/.).
  const pattern =
    kind === "email"
      ? new RegExp(escapeRegex(needle), "gi")
      : new RegExp(`\\b${escapeRegex(needle)}\\b`, "gi");
  return text.replace(pattern, "[redacted]");
}

/**
 * Validate an LLM response against the developer roster. Returns the original
 * text when nothing suspicious is found, a redacted text when names/emails are
 * present but redaction is sufficient, or a generic fallback when the response
 * is heavily per-dev shaped.
 *
 * Always fire-and-forget telemetry on a non-allow result.
 */
export async function validateAndRedactTeamOutput(
  sql: SQL,
  text: string,
  opts: ValidateOptions
): Promise<GroundingResult> {
  if (!text) {
    return { action: "allow", text, hits: [] };
  }

  const roster = await loadRoster(sql);
  const hits: GroundingHit[] = [];
  let working = text;

  // 1. Roster matches (names + emails).
  const lower = text.toLowerCase();
  // Track unique developer ids so we don't double-count the same person matching
  // both their name and their email.
  const seenIds = new Set<string>();
  for (const entry of roster) {
    if (!lower.includes(entry.needle)) continue;
    // word-boundary check for names to avoid matching "Tim" in "estimate"
    if (entry.kind === "name") {
      const re = new RegExp(`\\b${escapeRegex(entry.needle)}\\b`, "i");
      if (!re.test(text)) continue;
    }
    hits.push({
      kind: entry.kind,
      match: entry.display,
      developerId: entry.developerId,
    });
    seenIds.add(entry.developerId);
    working = redactNeedle(working, entry.needle, entry.kind);
  }

  // 2. Per-dev shape detection (sentence/bullet patterns).
  const shapeHits = detectPerDevShape(text);
  hits.push(...shapeHits);

  if (hits.length === 0) {
    return { action: "allow", text, hits: [] };
  }

  // Decide whether redaction is "enough" or we should reject outright.
  // Rejection criteria:
  //   - any per-dev shape hit (table/list/sentence) — those keep meaning even
  //     after name redaction (e.g. "[redacted] completed 12 sessions" is still
  //     individual-level telemetry).
  //   - more than 5 roster matches (heavy per-dev content).
  const shouldReject =
    shapeHits.length > 0 || seenIds.size > 5 || hits.length > 8;

  const fallback = opts.fallback ?? DEFAULT_FALLBACK;
  const result: GroundingResult = shouldReject
    ? { action: "reject", text: fallback, hits }
    : { action: "redact", text: working, hits };

  // Telemetry — fire-and-forget. Never let logging failures break a user request.
  try {
    logEthicsEvent(sql, opts.orgId ?? null, "ai_individual_reference_blocked", {
      surface: opts.surface,
      action: result.action,
      hit_count: hits.length,
      roster_match_developer_ids: Array.from(seenIds),
      hit_kinds: hits.map((h) => h.kind),
      // Include the matched fragments so pilot audit can review what slipped.
      // Names only — never the surrounding sentence (would itself be PII).
      sample_matches: hits.slice(0, 5).map((h) => h.match),
    });
  } catch (err) {
    console.error("[ai-grounding] failed to record audit event", err);
  }

  // Console line so the pilot operator can grep logs in real time.
  console.warn(
    `[ai-grounding] action=${result.action} surface=${opts.surface} hits=${hits.length} kinds=${hits.map((h) => h.kind).join(",")}`
  );

  return result;
}
