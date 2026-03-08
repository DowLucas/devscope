export interface ActivityDataPoint {
  day: string;
  total_events: number;
  sessions: number;
  prompts: number;
  tool_calls: number;
}

export interface ToolUsageDataPoint {
  tool_name: string;
  success_count: number;
  fail_count: number;
  total: number;
}

export interface SessionStatsDataPoint {
  day: string;
  session_count: number;
  avg_duration_minutes: number;
  total_duration_minutes: number;
}

export interface SessionStatsSummary {
  total_sessions: number;
  avg_duration_minutes: number;
  active_days: number;
  unique_developers: number;
}

export interface ProjectActivityDataPoint {
  project_name: string;
  project_path: string;
  session_count: number;
  event_count: number;
  total_minutes: number;
}

/** Team-level activity summary — aggregates only, no per-developer ranking. */
export interface TeamActivityEntry {
  total_sessions: number;
  total_events: number;
  total_prompts: number;
  total_tool_calls: number;
  active_developers: number;
  period_days: number;
}

export interface HourlyDistributionPoint {
  hour: number;
  event_count: number;
}

export interface PeriodComparisonResult {
  current: {
    sessions: number;
    prompts: number;
    tool_calls: number;
    failures: number;
    active_developers: number;
  };
  previous: {
    sessions: number;
    prompts: number;
    tool_calls: number;
    failures: number;
    active_developers: number;
  };
  deltas: {
    sessions: number;
    prompts: number;
    tool_calls: number;
    failures: number;
    active_developers: number;
  };
}

export interface ToolFailureRatePoint {
  day: string;
  tool_name: string;
  success_count: number;
  fail_count: number;
  failure_rate: number;
}

export interface FailureCluster {
  tool_name: string;
  session_id: string;
  fail_count: number;
  error_messages: string[];
}

export interface AlertRule {
  id: string;
  rule_type: string;
  threshold: number;
  window_minutes: number;
  tool_name: string | null;
  enabled: boolean;
  created_at: string;
}

export interface AlertEvent {
  id: string;
  rule_id: string;
  session_id: string;
  developer_id: string;
  developer_name?: string;
  tool_name: string;
  failure_count: number;
  triggered_at: string;
  acknowledged: boolean;
}

export interface TeamHealthData {
  velocity: VelocityTrend;
  sessionsNeedingAttention: SessionNeedingAttention[];
}

export interface VelocityTrend {
  current_week: {
    sessions: number;
    prompts: number;
    tool_calls: number;
  };
  previous_week: {
    sessions: number;
    prompts: number;
    tool_calls: number;
  };
  percent_change: {
    sessions: number;
    prompts: number;
    tool_calls: number;
  };
}

/** Sessions with high tool failure rates — indicates tooling issues, not developer issues. */
export interface SessionNeedingAttention {
  session_id: string;
  project_name: string;
  tool_failure_rate: number;
}

export interface ProjectDetail {
  name: string;
  path: string;
  active_sessions: number;
  total_sessions: number;
  total_events: number;
  total_minutes: number;
  contributor_count: number;
  failure_rate: number;
  last_activity: string;
  health_score: number;
}

export interface ProjectContributor {
  developer_id: string;
  name: string;
  session_count: number;
  prompt_count: number;
  last_active: string;
}

export interface MinuteActivityPoint {
  minute: string; // ISO timestamp truncated to minute
  event_count: number;
  prompts: number;
  tool_calls: number;
  sessions: number;
}

export interface DigestEntry {
  id: string;
  digest_type: string;
  period_start: string;
  period_end: string;
  summary: DigestSummary;
  generated_at: string;
}

export interface DigestSummary {
  total_sessions: number;
  total_prompts: number;
  total_tool_calls: number;
  total_failures: number;
  active_developers: number;
  active_projects: number;
  top_projects: { name: string; events: number }[];
  notable_failures: { tool_name: string; count: number }[];
  scorecard?: { label: string; value: number; delta_percent: number; status: string }[];
  roi?: { prompts_per_session: number; tool_calls_per_session: number; sessions_per_developer: number };
  project_allocation?: { project_name: string; percentage: number }[];
}

// --- Tooling Health ---

export interface SkillUsageDataPoint {
  skill_name: string;
  success_count: number;
  fail_count: number;
  total: number;
  avg_duration_ms: number;
}

export interface ToolingHealthSummary {
  tool_name: string;
  project_name: string | null;
  total_calls: number;
  failure_count: number;
  failure_rate: number;
  avg_duration_ms: number | null;
  trend: "improving" | "stable" | "degrading";
}

export interface ToolingHealthTrend {
  date: string;
  tool_name: string;
  failure_rate: number;
  total_calls: number;
}
