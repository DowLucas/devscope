export interface WorkflowProfile {
  id: string;
  developer_id: string;
  period_start: string;
  period_end: string;
  iterative_vs_planning: number | null;
  tool_diversity: number | null;
  recovery_speed: number | null;
  session_depth: number | null;
  prompt_density: number | null;
  agent_usage: number | null;
  /**
   * Share of failure episodes rated "adapted" by TypeSafe. Null when the model
   * was unavailable or too few episodes were rated; show recovery_speed then.
   */
  recovery_quality?: number | null;
  /** The same dimensions per session intent. Null on pre-042 rows. */
  by_intent?: Record<string, WorkflowIntentProfile> | null;
  raw_metrics: Record<string, unknown>;
  sessions_analyzed: number;
  computed_at: string;
}

/** Workflow DNA restricted to the sessions of a single intent. */
export interface WorkflowIntentProfile {
  iterative_vs_planning: number | null;
  tool_diversity: number | null;
  recovery_speed: number | null;
  recovery_quality: number | null;
  session_depth: number | null;
  prompt_density: number | null;
  agent_usage: number | null;
  sessions_analyzed: number;
}

export interface TeamWorkflowSummary {
  dimension_averages: Record<string, number>;
  dimension_ranges: Record<string, { min: number; max: number }>;
  developer_count: number;
  period_start: string;
  period_end: string;
  /**
   * Team averages per session intent. An intent only appears when at least
   * `TEAM_INTENT_MIN_DEVELOPERS` developers have a slice for it, so a small
   * team's average cannot be solved back to one colleague's numbers.
   */
  by_intent?: Record<string, { dimension_averages: Record<string, number>; developer_count: number }>;
}

export const TEAM_INTENT_MIN_DEVELOPERS = 3;
