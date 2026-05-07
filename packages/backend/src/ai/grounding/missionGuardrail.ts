/**
 * Mission guardrail for the weekly-buyer report flow (DEV-45).
 *
 * The kill criterion in the [DEV-37 plan] is: any leak path where a
 * developer-identifying string reaches the LLM input pulls v1. To make that
 * provable post-hoc instead of trusted, every LLM input dispatched from the
 * weekly-buyer surface MUST go through this module:
 *
 *   1. `assertNoDeveloperIdentities` — synchronous tripwire that scans the
 *      serialized payload for emails, roster names, 16+ hex-char SHA-256
 *      candidates, and `apikey-*` tokens. On a hit it writes a
 *      `mission_violation` row to `ethics_audit_log` and throws
 *      `MissionViolationError` BEFORE the LLM call. Throwing is the point —
 *      a thrown error pulls the report rather than risk a leak.
 *
 *   2. `auditWeeklyReportInput` — happy-path log: writes one
 *      `weekly_report_llm_input` row per dispatched LLM call with the
 *      payload, persona, period, organization, timestamp, and SHA-256 hash
 *      of the payload. A CEO/COO can query that table over a pilot week to
 *      prove zero violations.
 *
 * Both helpers are synchronous-await (NOT the batched ethicsAudit logger) so
 * that an audit row is durable before the LLM ever sees the payload.
 *
 * Snapshot test in `__tests__/missionGuardrail.test.ts` proves the helper
 * layer aggregates correctly — i.e. that `gatherReportData` against a
 * synthetic team with realistic per-developer data underneath produces a
 * payload that passes this guardrail.
 */

import type { SQL } from "bun";

/** A leak class detected in the payload. */
export type GuardrailHitKind =
  | "developer_email"
  | "developer_name"
  | "developer_id_hash"
  | "api_key_token";

export interface GuardrailHit {
  kind: GuardrailHitKind;
  /** Truncated/redacted sample so audit log is informative without leaking PII. */
  sample: string;
  /** Path within the payload object where the hit was found (best-effort). */
  path?: string;
  /** For roster matches: the developer id whose identity surfaced. */
  developerId?: string;
}

export interface GuardrailContext {
  /** Org the report is being generated for. May be null until DEV-43 lands. */
  organizationId: string | null;
  /** Persona key, e.g. "weekly-buyer". */
  persona: string;
  /** Report period start (ISO date) — for audit attribution. */
  periodStart: string | null;
  /** Report period end (ISO date) — for audit attribution. */
  periodEnd: string | null;
  /** AI surface tag for telemetry, e.g. "reports.weekly-buyer.outline". */
  surface: string;
}

export class MissionViolationError extends Error {
  readonly hits: GuardrailHit[];
  readonly context: GuardrailContext;

  constructor(hits: GuardrailHit[], context: GuardrailContext) {
    const kinds = Array.from(new Set(hits.map((h) => h.kind))).join(",");
    super(
      `Mission guardrail: developer-identifying content detected in ` +
        `${context.surface} payload (kinds=${kinds}, hits=${hits.length}). ` +
        `LLM call aborted; mission_violation row written.`
    );
    this.name = "MissionViolationError";
    this.hits = hits;
    this.context = context;
  }
}

// --- Detection ------------------------------------------------------------

/** Names shorter than this are skipped (high false-positive rate). */
const MIN_NAME_LENGTH = 3;

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

/**
 * Strict 16+ contiguous lowercase-or-mixed hex run. Standard UUIDs have at
 * most 12 contiguous hex chars (the last group), so this does not flag UUIDs
 * but does flag the plugin's `SHA256(git config user.email)` developer ids
 * (64 hex chars).
 */
const HEX_HASH_RE = /[0-9a-fA-F]{16,}/g;

/** `apikey-...` literal token (better-auth API key prefix). Case-insensitive. */
const APIKEY_RE = /\bapikey-[A-Za-z0-9_-]{4,}/g;

interface RosterEntry {
  needle: string; // lowercased token form
  display: string; // original casing for telemetry
  kind: "name" | "email";
  developerId: string;
}

const ROSTER_CACHE_TTL_MS = 5 * 60_000;
let rosterCache: { fetchedAt: number; entries: RosterEntry[] } | null = null;

export function _resetMissionRosterCache() {
  rosterCache = null;
}

async function loadRoster(sql: SQL): Promise<RosterEntry[]> {
  const now = Date.now();
  if (rosterCache && now - rosterCache.fetchedAt < ROSTER_CACHE_TTL_MS) {
    return rosterCache.entries;
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
        for (const tok of tokens) {
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

  rosterCache = { fetchedAt: now, entries };
  return entries;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncate(s: string, max = 24): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * Walk the payload object collecting (path, stringValue) pairs. Used so that
 * a hit can report which key carried the leak. Bounded depth to keep cost
 * predictable on big aggregates.
 */
function* walkStrings(
  value: unknown,
  path = "$",
  depth = 0
): Generator<{ path: string; value: string }> {
  if (depth > 12) return;
  if (value == null) return;
  if (typeof value === "string") {
    yield { path, value };
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      yield* walkStrings(value[i], `${path}[${i}]`, depth + 1);
    }
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    yield* walkStrings(v, `${path}.${k}`, depth + 1);
  }
}

/**
 * Scan a payload for developer-identifying content. Pure function — no DB
 * writes, no throws. The caller decides what to do with the hits.
 */
export async function detectDeveloperIdentities(
  sql: SQL,
  payload: unknown
): Promise<GuardrailHit[]> {
  const hits: GuardrailHit[] = [];
  const roster = await loadRoster(sql);

  // Build a single lower-cased serialization for cheap roster matching, plus
  // walk the payload structure for path-attributed regex hits.
  const serialized = JSON.stringify(payload ?? null);
  const lowerSerialized = serialized.toLowerCase();

  // 1. Roster matches. A name in the lowercased serialization with a word
  //    boundary still wins (avoids "tim" inside "estimate"). Email is a
  //    substring (boundary semantics don't behave well around @/.).
  const seenRosterIds = new Set<string>();
  for (const entry of roster) {
    if (!lowerSerialized.includes(entry.needle)) continue;
    if (entry.kind === "name") {
      const re = new RegExp(`\\b${escapeRegex(entry.needle)}\\b`, "i");
      if (!re.test(serialized)) continue;
    }
    if (seenRosterIds.has(entry.developerId + ":" + entry.kind)) continue;
    seenRosterIds.add(entry.developerId + ":" + entry.kind);
    hits.push({
      kind: entry.kind === "name" ? "developer_name" : "developer_email",
      sample: truncate(entry.display),
      developerId: entry.developerId,
    });
  }

  // 2. Per-leaf regex matches (with path). We scan the structure rather than
  //    the flat serialization so path can be attributed and unrelated number
  //    aggregates can't confuse the hash check.
  for (const { path, value } of walkStrings(payload)) {
    const hexMatches = value.match(HEX_HASH_RE);
    if (hexMatches) {
      for (const hex of hexMatches) {
        hits.push({
          kind: "developer_id_hash",
          sample: truncate(hex),
          path,
        });
      }
    }
    const apiMatches = value.match(APIKEY_RE);
    if (apiMatches) {
      for (const key of apiMatches) {
        hits.push({
          kind: "api_key_token",
          sample: truncate(key),
          path,
        });
      }
    }
  }

  return hits;
}

// --- Audit-log writes -----------------------------------------------------

async function writeAuditRow(
  sql: SQL,
  organizationId: string | null,
  eventType: "weekly_report_llm_input" | "mission_violation",
  details: Record<string, unknown>
): Promise<void> {
  await sql`
    INSERT INTO ethics_audit_log (id, organization_id, event_type, details)
    VALUES (${crypto.randomUUID()}, ${organizationId}, ${eventType}, ${details}::jsonb)
  `;
}

/**
 * SHA-256 of the canonical JSON serialization of the payload. Stored on every
 * audit row so a CEO/COO can correlate the audit log to a specific generated
 * report. Hex-encoded, 64 chars.
 */
export async function payloadHashHex(payload: unknown): Promise<string> {
  const text = JSON.stringify(payload ?? null);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Tripwire. Run this on every LLM input from the weekly-buyer surface
 * BEFORE the LLM call. On a hit, writes a `mission_violation` audit row
 * and throws `MissionViolationError`. On a clean payload, returns silently.
 *
 * NOTE: this function does NOT write the happy-path `weekly_report_llm_input`
 * row — call `auditWeeklyReportInput` for that. They are separated so that
 * only successful guardrail passes write the happy-path row.
 */
export async function assertNoDeveloperIdentities(
  sql: SQL,
  payload: unknown,
  ctx: GuardrailContext
): Promise<void> {
  const hits = await detectDeveloperIdentities(sql, payload);
  if (hits.length === 0) return;

  // Surface to console immediately so a pilot operator grepping logs can
  // see the violation in real time even before the audit-log write.
  console.error(
    `[mission-guardrail] VIOLATION surface=${ctx.surface} ` +
      `org=${ctx.organizationId ?? "null"} persona=${ctx.persona} ` +
      `kinds=${Array.from(new Set(hits.map((h) => h.kind))).join(",")} ` +
      `hits=${hits.length}`
  );

  try {
    await writeAuditRow(sql, ctx.organizationId, "mission_violation", {
      surface: ctx.surface,
      persona: ctx.persona,
      period_start: ctx.periodStart,
      period_end: ctx.periodEnd,
      hit_count: hits.length,
      hit_kinds: Array.from(new Set(hits.map((h) => h.kind))),
      sample_hits: hits.slice(0, 8).map((h) => ({
        kind: h.kind,
        sample: h.sample,
        path: h.path,
        developer_id: h.developerId,
      })),
      // No payload contents — the row should not itself become a leak path.
      payload_hash: await payloadHashHex(payload),
    });
  } catch (err) {
    // If the audit-write itself fails we still throw the mission error —
    // failing-open here would silently bypass the kill criterion.
    console.error(
      "[mission-guardrail] failed to persist mission_violation row",
      err
    );
  }

  throw new MissionViolationError(hits, ctx);
}

/**
 * Happy-path: write one `weekly_report_llm_input` row capturing what was
 * dispatched. Call this AFTER the guardrail passes and BEFORE the LLM call
 * (or right after — the row's purpose is provenance, not blocking).
 *
 * The full team-aggregated payload is stored in `details.payload` because
 * by construction it has been verified free of developer identities.
 */
export async function auditWeeklyReportInput(
  sql: SQL,
  payload: unknown,
  ctx: GuardrailContext
): Promise<void> {
  await writeAuditRow(sql, ctx.organizationId, "weekly_report_llm_input", {
    surface: ctx.surface,
    persona: ctx.persona,
    period_start: ctx.periodStart,
    period_end: ctx.periodEnd,
    payload_hash: await payloadHashHex(payload),
    payload,
  });
}

/**
 * Convenience: assert + audit in one call. Returns the payload hash so the
 * caller can attach it to the LLM-call telemetry if useful.
 */
export async function guardWeeklyReportInput(
  sql: SQL,
  payload: unknown,
  ctx: GuardrailContext
): Promise<{ payloadHash: string }> {
  await assertNoDeveloperIdentities(sql, payload, ctx);
  await auditWeeklyReportInput(sql, payload, ctx);
  return { payloadHash: await payloadHashHex(payload) };
}
