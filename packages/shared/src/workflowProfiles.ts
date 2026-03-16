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
  raw_metrics: Record<string, unknown>;
  sessions_analyzed: number;
  computed_at: string;
}

export interface TeamWorkflowSummary {
  dimension_averages: Record<string, number>;
  dimension_ranges: Record<string, { min: number; max: number }>;
  developer_count: number;
  period_start: string;
  period_end: string;
}
