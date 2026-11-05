// Bash command timing (command_runs, migration 058; /api/commands).
// Rows carry commands and projects, never developers.

export type CommandScope = "team" | "me";
export type CommandGroup = "signature" | "program";

/** One command (signature or program) over the period, with the period before for comparison. */
export interface CommandSummaryRow {
  /** "bun run build"; a teammate's session that is not shared counts under its program ("bun"). */
  command: string;
  runs: number;
  failures: number;
  interrupted: number;
  /** run_in_background */
  background_runs: number;
  /** started in the foreground and moved to the background (timeout or user) */
  moved_runs: number;
  /** background commands not reported as settled */
  running: number;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
  /** time the sessions waited on it (foreground time, plus time until backgrounding) */
  wait_ms: number;
  /** start-to-finish time of every run that finished */
  total_ms: number;
  prev_runs: number;
  prev_p50_ms: number | null;
  prev_wait_ms: number;
}

export interface CommandSummary {
  days: number;
  scope: CommandScope;
  group: CommandGroup;
  project: string | null;
  totals: { runs: number; wait_ms: number; prev_runs: number; prev_wait_ms: number };
  commands: CommandSummaryRow[];
}

export interface CommandTrendPoint {
  /** bucket start, ISO date */
  bucket: string;
  runs: number;
  failures: number;
  p50_ms: number | null;
  p95_ms: number | null;
  wait_ms: number;
}

export interface CommandTrend {
  days: number;
  bucket: "day" | "week";
  command: string | null;
  project: string | null;
  points: CommandTrendPoint[];
}

export interface CommandProjectRow {
  project: string;
  runs: number;
  wait_ms: number;
}
