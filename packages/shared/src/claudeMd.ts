export interface ClaudeMdSnapshot {
  id: string;
  organization_id: string | null;
  project_name: string;
  project_path: string;
  content_hash: string;
  content_size: number;
  content_text: string | null;
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
