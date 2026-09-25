import type { SQL } from "bun";
import { getSessionVisibilityRows, getSharingDeveloperIds } from "../db";
import { getAllDeveloperIdsForUser } from "./developerLink";

/**
 * What a viewer may see of one session and its events.
 *
 * - self:     the viewer owns the session — everything.
 * - shared:   the owner opted in (developers.share_details) and the session is
 *             not plugin-private — everything the owner sees.
 * - activity: anything else — identity, status and timing only.
 */
export type Visibility = "self" | "shared" | "activity";

export function teammateVisibility(
  ownerShareDetails: boolean | null | undefined,
  privacyMode: string | null | undefined,
): Exclude<Visibility, "self"> {
  return ownerShareDetails === true && privacyMode !== "private" ? "shared" : "activity";
}

export function resolveVisibility(opts: {
  viewerDevIds: string[];
  ownerDevId: string;
  ownerShareDetails: boolean | null | undefined;
  privacyMode: string | null | undefined;
}): Visibility {
  if (opts.viewerDevIds.includes(opts.ownerDevId)) return "self";
  return teammateVisibility(opts.ownerShareDetails, opts.privacyMode);
}

/** Resolve visibility for a session row that carries owner_share_details. */
export function visibilityForRow(row: any, viewerDevIds: string[]): Visibility {
  return resolveVisibility({
    viewerDevIds,
    ownerDevId: row.developer_id,
    ownerShareDetails: row.owner_share_details,
    privacyMode: row.privacy_mode,
  });
}

// Allowlists: anything not listed is dropped for activity-only viewers, so a
// column added later stays hidden until someone decides it is safe to show.
const ACTIVITY_SESSION_KEYS = [
  "id", "developer_id", "developer_name", "developer_email",
  "started_at", "ended_at", "status", "event_count", "context_clear_count",
] as const;

const ACTIVITY_EVENT_KEYS = [
  "id", "session_id", "event_type", "created_at",
  "timestamp", "sessionId", "developerId", "developerName", "developerEmail", "eventType",
] as const;

function pick(obj: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

/** Redact a snake_case session row from the DB. */
export function redactSessionRow(row: Record<string, unknown>, v: Visibility): Record<string, unknown> {
  if (v !== "activity") return row;
  return { ...pick(row, ACTIVITY_SESSION_KEYS), project_path: null, project_name: null };
}

/**
 * Redact an event, either a DB row (snake_case) or a DevscopeEvent (camelCase).
 * shared: drops transcriptPath, a local filesystem path only the owner can use.
 * activity: project fields nulled when present, payload emptied.
 */
export function redactEvent(event: Record<string, unknown>, v: Visibility): Record<string, unknown> {
  if (v === "self") return event;
  if (v === "shared") {
    const payload = event.payload as Record<string, unknown> | null | undefined;
    if (!payload || typeof payload !== "object" || !("transcriptPath" in payload)) return event;
    const { transcriptPath: _local, ...rest } = payload;
    return { ...event, payload: rest };
  }
  const out: Record<string, unknown> = pick(event, ACTIVITY_EVENT_KEYS);
  for (const k of ["project_name", "project_path", "projectName", "projectPath"]) {
    if (k in event) out[k] = null;
  }
  out.payload = {};
  return out;
}

/** Developer ids linked to the authenticated user on this request. */
export async function getViewerDevIds(sql: SQL, c: { get: (k: never) => unknown }): Promise<string[]> {
  const user = c.get("user" as never) as { id?: string } | undefined;
  return user?.id ? await getAllDeveloperIdsForUser(sql, user.id) : [];
}

/**
 * The org developers whose content this viewer may search: their own ids plus
 * everyone who opted in. Private sessions are excluded by the search queries.
 */
export async function getSearchableDevIds(
  sql: SQL,
  orgDevIds: string[],
  viewerDevIds: string[],
): Promise<string[]> {
  if (orgDevIds.length === 0) return [];
  const sharing = await getSharingDeveloperIds(sql, orgDevIds);
  const org = new Set(orgDevIds);
  return [...new Set([...viewerDevIds.filter((d) => org.has(d)), ...sharing])];
}

function reportSessionId(report: { report_type?: string; data_context?: unknown }): string | null {
  if (report.report_type !== "session") return null;
  const ctx = typeof report.data_context === "string" ? JSON.parse(report.data_context) : report.data_context;
  return (ctx as { session_id?: string } | null)?.session_id ?? null;
}

/**
 * Drop session-feedback reports about sessions this viewer only sees as
 * activity. Team reports (daily/weekly/custom) pass through.
 */
export async function filterVisibleReports<T extends { report_type?: string; data_context?: unknown }>(
  sql: SQL,
  reports: T[],
  viewerDevIds: string[],
): Promise<T[]> {
  const ids = [...new Set(reports.map(reportSessionId).filter((id): id is string => id !== null))];
  const sessions = new Map((await getSessionVisibilityRows(sql, ids)).map((r: any) => [r.id, r]));
  return reports.filter((r) => {
    const id = reportSessionId(r);
    if (id === null) return r.report_type !== "session";
    const row = sessions.get(id);
    return row !== undefined && visibilityForRow(row, viewerDevIds) !== "activity";
  });
}
