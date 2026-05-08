export interface ClaudeMdSnapshot {
  id: string;
  organization_id: string | null;
  project_name: string;
  project_path: string;
  content_hash: string;
  content_size: number;
  content_text: string | null;
  file_type?: string | null;
  session_id: string;
  developer_id: string;
  captured_at: string;
}

export interface ClaudeMdCorrelation {
  id: string;
  snapshot_id: string;
  project_path: string;
  window_start: string;
  window_end: string;
  sessions_count: number;
  avg_failure_rate: number | null;
  avg_prompt_count: number | null;
  avg_session_duration_min: number | null;
  computed_at: string;
}

export interface ClaudeMdTimelineEntry {
  snapshot: ClaudeMdSnapshot;
  correlation: ClaudeMdCorrelation | null;
}

/**
 * A single recurring search/read term that does not appear in the org's most
 * recent CLAUDE.md snapshots — i.e. a candidate documentation gap surfaced in
 * the weekly-buyer report. Team-aggregate by construction: no developer ids
 * or names, only session UUIDs as sample contexts.
 */
export interface DocGapCandidate {
  /** The literal term as observed in events (search pattern, file basename, or directory). */
  term: string;
  /** Source of the term — drives how the report frames it in the bullet. */
  kind: "grep_pattern" | "file_path" | "directory";
  /** Number of matching tool events in the period. */
  count: number;
  /** Up to 3 distinct session UUIDs where the term appeared (UUIDs only — not developer-identifying). */
  sample_session_ids: string[];
}

export interface DocGapPeriod {
  /** Inclusive ISO timestamp. */
  start: string;
  /** Exclusive ISO timestamp. */
  end: string;
}
