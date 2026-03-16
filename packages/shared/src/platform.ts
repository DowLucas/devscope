// --- Feature 1: AI Tooling Maturity Index ---

export interface MaturityDimensions {
  tool_adoption: number;
  workflow_efficiency: number;
  failure_recovery: number;
  skill_adoption: number;
  ai_collaboration: number;
}

export interface AiMaturitySnapshot {
  id: string;
  organization_id: string;
  snapshot_date: string;
  overall_score: number | null;
  dimensions: MaturityDimensions;
  data_context: Record<string, unknown>;
  narrative: string | null;
  created_at: string;
}

// --- Feature 2: Executive Briefing Reports ---
// ReportPersona type is defined in ai.ts

// --- Feature 3: Anonymous Cross-Org Benchmarking ---

export interface BenchmarkMetrics {
  sessions_per_day: number;
  tool_success_rate: number;
  prompts_per_session: number;
  anti_pattern_rate: number;
  agent_delegation_pct: number;
  avg_session_duration_min: number;
  team_size: number;
}

export interface BenchmarkContribution {
  id: string;
  organization_id: string;
  period_start: string;
  period_end: string;
  metrics: BenchmarkMetrics;
  contributed_at: string;
}

export interface BenchmarkPercentile {
  metric_name: string;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  sample_size: number;
}

export interface BenchmarkPosition {
  metric_name: string;
  value: number;
  percentile: number;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

// --- Feature 4: Playbook Marketplace ---

export type MarketplaceStatus = "pending" | "published" | "removed";

export interface MarketplacePlaybook {
  id: string;
  source_playbook_id: string | null;
  source_org_id: string | null;
  name: string;
  description: string;
  tool_sequence: string[];
  when_to_use: string;
  success_metrics: Record<string, unknown>;
  category: string | null;
  tags: string[];
  adoption_count: number;
  avg_rating: number | null;
  status: MarketplaceStatus;
  published_at: string | null;
  created_at: string;
}

export interface MarketplaceAdoption {
  id: string;
  marketplace_playbook_id: string;
  adopting_org_id: string;
  adopted_at: string;
  rating: number | null;
}

// --- Feature 5: Predictive Session Health ---

export interface SessionHealthScore {
  id: string;
  session_id: string;
  score: number;
  risk_factors: Record<string, unknown>;
  suggested_playbook_id: string | null;
  suggested_skill_id: string | null;
  created_at: string;
}

export type HealthLevel = "healthy" | "warning" | "critical";

// --- Feature 6: Ethics Transparency Report ---

export interface TransparencyReport {
  period_days: number;
  ethics_summary: {
    total_events: number;
    by_type: Record<string, number>;
  };
  consent_overview: {
    total_developers: number;
    sharing_details: number;
    privacy_mode_count: number;
  };
  guardrail_activations: {
    individual_references_blocked: number;
    sensitive_fields_stripped: number;
  };
  data_retention: {
    retention_days: number;
    purges_executed: number;
  };
  privacy_mode_adoption_rate: number;
}

// WebSocket message types for platform features are defined in models.ts WsMessageType union.
