export type TrafficLight = "green" | "yellow" | "red";
export type TrendDirection = "up" | "down" | "flat";

export interface KpiMetric {
  label: string;
  value: number;
  previous_value: number;
  delta_percent: number;
  trend: TrendDirection;
  status: TrafficLight;
  unit?: string;
}

export interface ExecutiveScorecard {
  kpis: KpiMetric[];
  generated_at: string;
  period_days: number;
}

export interface BurnoutRiskEntry {
  developer_id: string;
  developer_name: string;
  off_hours_ratio: number;
  weekend_events: number;
  session_frequency_spike: number;
  risk_level: "high" | "medium" | "low";
}

export interface AiRoiMetrics {
  prompts_per_session: number;
  tool_calls_per_session: number;
  sessions_per_developer: number;
  active_days_per_developer: number;
  total_sessions: number;
  total_developers: number;
  period_days: number;
  kpis: KpiMetric[];
  project_allocation: ProjectAllocation[];
}

export interface ProjectAllocation {
  project_name: string;
  session_count: number;
  percentage: number;
}

export interface ManagerSummary {
  velocity: {
    sessions: KpiMetric;
    prompts: KpiMetric;
    tool_calls: KpiMetric;
  };
  burnout_risks: BurnoutRiskEntry[];
  failure_clusters: {
    tool_name: string;
    session_id: string;
    developer_name: string;
    fail_count: number;
  }[];
  stuck_sessions: {
    session_id: string;
    developer_name: string;
    project_name: string;
    idle_minutes: number;
    tool_failure_rate: number;
  }[];
}
