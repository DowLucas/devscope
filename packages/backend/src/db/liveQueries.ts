import type { SQL } from "bun";
import type { TurnLabel } from "@devscope/shared";
import { inList } from "./utils";

// Queries behind /api/live (the devscope-live mod). Turn labels and VCS links
// are self-only (migration 055); suggestions read prompt_turns (migration 045)
// within the caller's searchable scope and never carry a developer identity.

/** A label belongs to the nearest turn whose prompt started within this window. */
export const LABEL_MATCH_SECONDS = 120;

export interface OwnedSession {
  id: string;
  privacy_mode: string | null;
}

/**
 * The DevScope session behind a Claude Code session id, owned by one of
 * `devIds`. The plugin keeps one DevScope session across /clear, so a later
 * Claude Code id is found through the `claudeSessionId` its session.start
 * event carries.
 */
export async function resolveOwnedSession(
  sql: SQL,
  claudeSessionId: string,
  devIds: string[],
): Promise<OwnedSession | null> {
  if (devIds.length === 0) return null;
  const [row] = await sql`
    (SELECT s.id, s.privacy_mode FROM sessions s
     WHERE s.id = ${claudeSessionId} AND s.developer_id IN (${inList(devIds)}))
    UNION ALL
    (SELECT s.id, s.privacy_mode FROM events e
     JOIN sessions s ON s.id = e.session_id
     WHERE e.event_type = 'session.start'
       AND e.payload->>'claudeSessionId' = ${claudeSessionId}
       AND s.developer_id IN (${inList(devIds)})
     ORDER BY e.created_at DESC
     LIMIT 1)
    LIMIT 1`;
  return (row as OwnedSession | undefined) ?? null;
}

export async function insertTurnLabel(
  sql: SQL,
  label: { sessionId: string; turnStartedAt: string; label: TurnLabel; source: "explicit" | "implicit" },
): Promise<void> {
  await sql`
    INSERT INTO turn_labels (session_id, turn_started_at, label, source)
    VALUES (${label.sessionId}, ${label.turnStartedAt}::TIMESTAMPTZ, ${label.label}, ${label.source})`;
}

export async function insertVcsLink(
  sql: SQL,
  link: { sessionId: string; kind: "commit" | "pr"; ref: string; repoRemote: string | null },
): Promise<void> {
  await sql`
    INSERT INTO session_vcs_links (session_id, kind, ref, repo_remote)
    VALUES (${link.sessionId}, ${link.kind}, ${link.ref}, ${link.repoRemote})
    ON CONFLICT (session_id, kind, ref) DO UPDATE
      SET repo_remote = COALESCE(session_vcs_links.repo_remote, EXCLUDED.repo_remote)`;
}

/**
 * The caller's PR links in `repoRemote` whose state is unknown or open and
 * that were not checked in the last hour, newest first.
 */
export async function getOpenPrRefs(
  sql: SQL,
  devIds: string[],
  repoRemote: string,
  limit: number,
): Promise<string[]> {
  if (devIds.length === 0) return [];
  const rows = await sql`
    SELECT l.ref
    FROM session_vcs_links l
    JOIN sessions s ON s.id = l.session_id
    WHERE s.developer_id IN (${inList(devIds)})
      AND l.kind = 'pr'
      AND l.repo_remote = ${repoRemote}
      AND l.state IN ('unknown', 'open')
      AND (l.checked_at IS NULL OR l.checked_at < NOW() - INTERVAL '1 hour')
    GROUP BY l.ref
    ORDER BY MAX(l.created_at) DESC
    LIMIT ${limit}`;
  return (rows as Array<{ ref: string }>).map((r) => r.ref);
}

/** Record a PR's state on the caller's own links to it; returns rows updated. */
export async function updatePrStatus(
  sql: SQL,
  devIds: string[],
  status: { ref: string; state: "open" | "merged" | "closed"; mergedAt: string | null; closedAt: string | null },
): Promise<number> {
  if (devIds.length === 0) return 0;
  const rows = await sql`
    UPDATE session_vcs_links l
    SET state = ${status.state},
        merged_at = ${status.mergedAt}::TIMESTAMPTZ,
        closed_at = ${status.closedAt}::TIMESTAMPTZ,
        checked_at = NOW()
    FROM sessions s
    WHERE s.id = l.session_id
      AND s.developer_id IN (${inList(devIds)})
      AND l.kind = 'pr'
      AND l.ref = ${status.ref}
    RETURNING l.id`;
  return (rows as unknown[]).length;
}

/**
 * For each source turn, the next human-typed turn of the same session: what
 * the developer asked after a similar prompt.
 */
export async function getNextTurnIds(
  sql: SQL,
  sourceTurnIds: string[],
): Promise<Array<{ source_turn_id: string; turn_id: string }>> {
  if (sourceTurnIds.length === 0) return [];
  return (await sql`
    SELECT src.id::TEXT AS source_turn_id, nxt.id::TEXT AS turn_id
    FROM prompt_turns src
    JOIN LATERAL (
      SELECT n.id FROM prompt_turns n
      WHERE n.session_id = src.session_id
        AND n.prompt_at > src.prompt_at
        AND COALESCE(n.origin, 'human') = 'human'
      ORDER BY n.prompt_at, n.id
      LIMIT 1
    ) nxt ON true
    WHERE src.id IN (${inList(sourceTurnIds)})
      AND COALESCE(src.origin, 'human') = 'human'`) as Array<{ source_turn_id: string; turn_id: string }>;
}

/**
 * The opening human-typed turn of the most recent `sessionLimit` sessions in
 * `project` within `devIds`.
 */
export async function getOpeningTurnIds(
  sql: SQL,
  opts: { devIds: string[]; project: string; excludeSessionId: string; sessionLimit: number },
): Promise<string[]> {
  if (opts.devIds.length === 0) return [];
  const rows = await sql`
    SELECT DISTINCT ON (t.session_id) t.id::TEXT AS turn_id
    FROM (
      SELECT s.id FROM sessions s
      WHERE s.developer_id IN (${inList(opts.devIds)})
        AND s.project_name = ${opts.project}
        AND s.id <> ${opts.excludeSessionId}
        AND COALESCE(s.privacy_mode, 'standard') <> 'private'
      ORDER BY s.started_at DESC
      LIMIT ${opts.sessionLimit}
    ) recent
    JOIN prompt_turns t ON t.session_id = recent.id
    WHERE COALESCE(t.origin, 'human') = 'human'
    ORDER BY t.session_id, t.prompt_at, t.id`;
  return (rows as Array<{ turn_id: string }>).map((r) => r.turn_id);
}

export interface SuggestionRow {
  turn_id: string;
  prompt_text: string;
  prompt_at: string;
  tool_calls: number;
  tool_failures: number;
  session_title: string | null;
  project_name: string;
  /** The session owner's label on this turn, if any. */
  label: TurnLabel | null;
  /** The session produced a PR that was merged. */
  has_merged_pr: boolean;
}

/**
 * Turns as suggestion candidates, with their outcome signals. Re-checks the
 * scope (`devIds`, not private) so a caller can pass any turn ids.
 */
export async function getTurnSuggestionRows(
  sql: SQL,
  turnIds: string[],
  devIds: string[],
  maxChars: number,
): Promise<SuggestionRow[]> {
  if (turnIds.length === 0 || devIds.length === 0) return [];
  return (await sql`
    SELECT
      t.id::TEXT AS turn_id,
      left(t.prompt_text, ${maxChars}) AS prompt_text,
      t.prompt_at,
      t.tool_calls,
      t.tool_failures,
      s.current_title AS session_title,
      s.project_name,
      lbl.label,
      EXISTS (
        SELECT 1 FROM session_vcs_links v
        WHERE v.session_id = t.session_id AND v.kind = 'pr' AND v.state = 'merged'
      ) AS has_merged_pr
    FROM prompt_turns t
    JOIN sessions s ON s.id = t.session_id
    LEFT JOIN LATERAL (
      -- The label nearest this turn's start, unless another turn of the
      -- session started nearer to it. An explicit label beats an inferred one.
      SELECT l.label FROM turn_labels l
      WHERE l.session_id = t.session_id
        AND abs(EXTRACT(EPOCH FROM (l.turn_started_at - t.prompt_at))) <= ${LABEL_MATCH_SECONDS}
        AND NOT EXISTS (
          SELECT 1 FROM prompt_turns o
          WHERE o.session_id = t.session_id
            AND o.id <> t.id
            AND abs(EXTRACT(EPOCH FROM (l.turn_started_at - o.prompt_at)))
              < abs(EXTRACT(EPOCH FROM (l.turn_started_at - t.prompt_at)))
        )
      ORDER BY (l.source = 'explicit') DESC, l.created_at DESC
      LIMIT 1
    ) lbl ON true
    WHERE t.id IN (${inList(turnIds)})
      AND s.developer_id IN (${inList(devIds)})
      AND COALESCE(s.privacy_mode, 'standard') <> 'private'`) as SuggestionRow[];
}
