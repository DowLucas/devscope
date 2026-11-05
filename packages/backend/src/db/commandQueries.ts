import type { SQL } from "bun";
import type {
  CommandGroup,
  CommandProjectRow,
  CommandSummary,
  CommandSummaryRow,
  CommandTrend,
  CommandTrendPoint,
  DevscopeEvent,
} from "@devscope/shared";
import { inList, visibleSessionSql } from "./utils";

// Bash command timing (command_runs, migration 058). Ingestion turns each Bash
// tool.complete / tool.fail into a row; command.background_complete settles the
// background ones. Reads aggregate by command and project, never by developer:
// a signature or project is named only for sessions the viewer may see, the
// rest count under their program (like toolSubcommand in the tool topology).

const MAX_MS = 2_147_483_647;

/** A signature the plugin's `_ds_command_signature` could have produced. */
const SIGNATURE = /^[a-z0-9._+-]{1,40}( [a-z][a-z0-9_:-]{0,23}){0,2}$/;

/**
 * Programs whose next word names what they do (a subcommand, script, target or
 * tool), the only ones whose signature may have more than one word. The same
 * list as `multi` in the plugin's `_ds_command_signature`: change both.
 */
const MULTI = new Set([
  "git", "gh", "glab", "docker", "podman", "kubectl", "helm", "terraform", "tofu",
  "npm", "pnpm", "yarn", "bun", "bunx", "npx", "deno", "cargo", "rustup",
  "go", "uv", "uvx", "pip", "pip3", "poetry", "pdm", "hatch", "conda",
  "brew", "apt", "apt-get", "dnf", "systemctl", "journalctl", "make", "just", "task",
  "claude", "gcloud", "aws", "az", "fly", "flyctl", "vercel", "wrangler", "supabase",
  "firebase", "dotnet", "mvn", "gradle", "gradlew", "mix", "rails", "bundle", "rake",
  "composer", "swift", "xcodebuild", "zig", "nix",
]);

/**
 * The stored signature: what the plugin sent when it has the expected shape
 * (more than one word only for a program in MULTI), else its first word
 * reduced to program characters. Defence in depth: the column must never hold
 * command text, whatever a plugin sends.
 */
export function cleanSignature(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const program = (s.split(" ")[0] ?? "").replace(/[^a-z0-9._+-]/g, "").slice(0, 40);
  if (SIGNATURE.test(s) && (!s.includes(" ") || MULTI.has(program))) return s;
  return program || null;
}

function clampMs(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), MAX_MS) : 0;
}

/** Record a Bash tool.complete / tool.fail. Idempotent per tool_use_id. */
export async function recordCommandRun(sql: SQL, event: DevscopeEvent): Promise<void> {
  if (event.eventType !== "tool.complete" && event.eventType !== "tool.fail") return;
  const p = (event.payload ?? {}) as Record<string, unknown>;
  if (p.toolName !== "Bash") return;

  const signature = cleanSignature(p.commandSignature) ?? cleanSignature(p.toolSubcommand) ?? "unknown";
  const program = signature.split(" ")[0]!;
  const hasId = typeof p.toolUseId === "string" && p.toolUseId.length > 0;
  const toolUseId = hasId ? (p.toolUseId as string) : `event:${event.id}`;
  const background = typeof p.backgroundTaskId === "string" && p.backgroundTaskId.length > 0;
  const mode = background ? (p.runInBackground === true ? "background" : "moved") : "foreground";
  const failed = event.eventType === "tool.fail";
  const outcome = failed ? (p.isInterrupt === true ? "interrupted" : "failure") : background ? "running" : "success";
  const waitMs = clampMs(p.duration);
  // PostToolUse fires when the command ends (or is backgrounded): the event's
  // timestamp is that moment, and the start is `duration` before it.
  const endedAt = new Date(event.timestamp);
  const startedAt = new Date(endedAt.getTime() - waitMs).toISOString();
  const settled = !background || failed;

  // Private sessions keep the program only, whatever the plugin sent.
  await sql`
    INSERT INTO command_runs (
      tool_use_id, event_id, session_id, program, signature, in_subagent, mode,
      started_at, wait_ms, duration_ms, outcome, finished_at, legacy_timing
    )
    SELECT
      ${toolUseId}, ${event.id}, s.id, ${program},
      CASE WHEN s.privacy_mode = 'private' THEN ${program} ELSE ${signature} END,
      ${typeof p.agentId === "string" && p.agentId.length > 0}, ${mode},
      ${startedAt}::timestamptz, ${waitMs}, ${settled ? waitMs : null},
      ${outcome}, ${settled ? endedAt.toISOString() : null}::timestamptz, ${!hasId}
    FROM sessions s
    WHERE s.id = ${event.sessionId}
    ON CONFLICT DO NOTHING`;
}

export interface SettledCommand {
  toolUseId: string;
  status: string;
  exitCode?: number;
  finishedAt: string;
}

const SETTLED_OUTCOME: Record<string, string> = {
  completed: "success",
  failed: "failure",
  killed: "killed",
};

/**
 * Settle background commands from command.background_complete. Only the
 * sender's own running rows change, matched by tool_use_id rather than session
 * (the report can arrive under another DevScope session id after /clear).
 */
export async function settleBackgroundCommands(
  sql: SQL,
  developerId: string,
  commands: SettledCommand[],
): Promise<number> {
  let settled = 0;
  for (const c of commands.slice(0, 200)) {
    const finished = new Date(c.finishedAt);
    if (Number.isNaN(finished.getTime())) continue;
    const outcome = SETTLED_OUTCOME[c.status] ?? "failure";
    const rows = await sql`
      UPDATE command_runs cr
      SET finished_at = ${finished.toISOString()}::timestamptz,
          duration_ms = LEAST(${MAX_MS}, GREATEST(cr.wait_ms,
            ROUND(EXTRACT(EPOCH FROM (${finished.toISOString()}::timestamptz - cr.started_at)) * 1000)))::INT,
          outcome = ${outcome},
          exit_code = ${Number.isInteger(c.exitCode) ? c.exitCode! : null}
      FROM sessions s
      WHERE cr.tool_use_id = ${c.toolUseId}
        AND cr.outcome = 'running'
        AND s.id = cr.session_id
        AND s.developer_id = ${developerId}
      RETURNING cr.tool_use_id`;
    settled += (rows as unknown[]).length;
  }
  return settled;
}

// --- Reads -----------------------------------------------------------------

export interface CommandReadScope {
  /** Developers whose runs count (the org's, or the caller's own in it). */
  devIds: string[];
  /** The viewer's own developer ids: decides what may be named. */
  viewerDevIds: string[];
  days: number;
  project: string | null;
}

/**
 * Runs in the scope since `sinceDays` ago, with `command` and `project` as
 * this viewer may see them. A named project filter only matches sessions the
 * viewer may see, so it cannot reveal where a hidden session ran.
 */
function scopedRuns(
  sql: SQL,
  scope: CommandReadScope,
  group: CommandGroup,
  sinceDays: number,
) {
  const vis = visibleSessionSql(scope.viewerDevIds);
  return sql`
    SELECT
      CASE WHEN ${group} = 'program' THEN cr.program
           WHEN ${vis} THEN cr.signature
           ELSE cr.program END AS command,
      cr.mode, cr.outcome, cr.wait_ms, cr.duration_ms, cr.started_at
    FROM command_runs cr
    JOIN sessions s ON s.id = cr.session_id
    WHERE s.developer_id IN (${inList(scope.devIds)})
      AND cr.started_at >= NOW() - make_interval(days => ${sinceDays})
      AND (${scope.project}::text IS NULL OR (${vis} AND s.project_name = ${scope.project}))`;
}

export async function getCommandSummary(
  sql: SQL,
  scope: CommandReadScope,
  group: CommandGroup,
  limit = 50,
): Promise<Omit<CommandSummary, "scope">> {
  const empty = {
    days: scope.days,
    group,
    project: scope.project,
    totals: { runs: 0, wait_ms: 0, failures: 0, moved_runs: 0, prev_runs: 0, prev_wait_ms: 0 },
    commands: [] as CommandSummaryRow[],
  };
  if (scope.devIds.length === 0) return empty;

  const rows = (await sql`
    WITH runs AS (${scopedRuns(sql, scope, group, scope.days * 2)}),
    tagged AS (
      SELECT *, started_at >= NOW() - make_interval(days => ${scope.days}) AS cur FROM runs
    )
    SELECT
      command,
      COUNT(*) FILTER (WHERE cur)::INT AS runs,
      COUNT(*) FILTER (WHERE cur AND outcome = 'failure')::INT AS failures,
      COUNT(*) FILTER (WHERE cur AND outcome = 'interrupted')::INT AS interrupted,
      COUNT(*) FILTER (WHERE cur AND mode = 'background')::INT AS background_runs,
      COUNT(*) FILTER (WHERE cur AND mode = 'moved')::INT AS moved_runs,
      COUNT(*) FILTER (WHERE cur AND outcome = 'running')::INT AS running,
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE cur))::FLOAT8 AS p50_ms,
      (percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE cur))::FLOAT8 AS p95_ms,
      (MAX(duration_ms) FILTER (WHERE cur))::FLOAT8 AS max_ms,
      COALESCE(SUM(wait_ms) FILTER (WHERE cur), 0)::FLOAT8 AS wait_ms,
      COALESCE(SUM(duration_ms) FILTER (WHERE cur), 0)::FLOAT8 AS total_ms,
      COUNT(*) FILTER (WHERE NOT cur)::INT AS prev_runs,
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE NOT cur))::FLOAT8 AS prev_p50_ms,
      COALESCE(SUM(wait_ms) FILTER (WHERE NOT cur), 0)::FLOAT8 AS prev_wait_ms
    FROM tagged
    GROUP BY command
    HAVING COUNT(*) FILTER (WHERE cur) > 0
    ORDER BY wait_ms DESC, runs DESC, command
  `) as CommandSummaryRow[];

  // Summed over every command before the list is cut to `limit`.
  const totals = { runs: 0, wait_ms: 0, failures: 0, moved_runs: 0, prev_runs: 0, prev_wait_ms: 0 };
  for (const r of rows) {
    totals.runs += r.runs;
    totals.wait_ms += r.wait_ms;
    totals.failures += r.failures;
    totals.moved_runs += r.moved_runs;
  }
  // Previous-period totals include commands that did not run this period.
  const [prev] = (await sql`
    WITH runs AS (${scopedRuns(sql, scope, group, scope.days * 2)})
    SELECT COUNT(*)::INT AS prev_runs, COALESCE(SUM(wait_ms), 0)::FLOAT8 AS prev_wait_ms
    FROM runs WHERE started_at < NOW() - make_interval(days => ${scope.days})
  `) as Array<{ prev_runs: number; prev_wait_ms: number }>;
  totals.prev_runs = prev?.prev_runs ?? 0;
  totals.prev_wait_ms = prev?.prev_wait_ms ?? 0;

  return { ...empty, totals, commands: rows.slice(0, limit) };
}

export async function getCommandTrend(
  sql: SQL,
  scope: CommandReadScope,
  group: CommandGroup,
  command: string | null,
  bucket: "day" | "week",
): Promise<Omit<CommandTrend, "days">> {
  const base = { bucket, command, project: scope.project };
  if (scope.devIds.length === 0) return { ...base, points: [] };
  const points = (await sql`
    WITH runs AS (${scopedRuns(sql, scope, group, scope.days)}),
    picked AS (SELECT * FROM runs WHERE ${command}::text IS NULL OR command = ${command}),
    buckets AS (
      SELECT generate_series(
        date_trunc(${bucket}, NOW() - make_interval(days => ${scope.days})),
        date_trunc(${bucket}, NOW()),
        ('1 ' || ${bucket})::interval
      ) AS bucket
    )
    SELECT
      to_char(b.bucket, 'YYYY-MM-DD') AS bucket,
      COUNT(p.started_at)::INT AS runs,
      COUNT(p.started_at) FILTER (WHERE p.outcome = 'failure')::INT AS failures,
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY p.duration_ms))::FLOAT8 AS p50_ms,
      (percentile_cont(0.95) WITHIN GROUP (ORDER BY p.duration_ms))::FLOAT8 AS p95_ms,
      COALESCE(SUM(p.wait_ms), 0)::FLOAT8 AS wait_ms
    FROM buckets b
    LEFT JOIN picked p ON date_trunc(${bucket}, p.started_at) = b.bucket
    GROUP BY b.bucket
    ORDER BY b.bucket
  `) as CommandTrendPoint[];
  return { ...base, points };
}

/** Projects with command runs the viewer may see, busiest first. */
export async function getCommandProjects(
  sql: SQL,
  scope: Omit<CommandReadScope, "project">,
): Promise<CommandProjectRow[]> {
  if (scope.devIds.length === 0) return [];
  const vis = visibleSessionSql(scope.viewerDevIds);
  return (await sql`
    SELECT s.project_name AS project, COUNT(*)::INT AS runs, COALESCE(SUM(cr.wait_ms), 0)::FLOAT8 AS wait_ms
    FROM command_runs cr
    JOIN sessions s ON s.id = cr.session_id
    WHERE s.developer_id IN (${inList(scope.devIds)})
      AND cr.started_at >= NOW() - make_interval(days => ${scope.days})
      AND ${vis}
      AND s.project_name IS NOT NULL AND s.project_name NOT IN ('', 'redacted')
    GROUP BY s.project_name
    ORDER BY wait_ms DESC
    LIMIT 100
  `) as CommandProjectRow[];
}
