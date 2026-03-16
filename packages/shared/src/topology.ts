export type ProficiencyLevel = "strong" | "developing" | "struggling" | "unknown";
export type CoverageLevel = "widespread" | "partial" | "narrow" | "unknown";
export type SkillGapType = "high_failure" | "low_adoption" | "single_expert" | "degrading";

export interface TeamToolTopology {
  id: string;
  organization_id: string;
  tool_name: string;
  period_start: string;
  period_end: string;
  total_uses: number;
  unique_users: number;
  success_count: number;
  failure_count: number;
  failure_rate: number | null;
  avg_duration_ms: number | null;
  proficiency_level: ProficiencyLevel;
  coverage_level: CoverageLevel;
  computed_at: string;
}

export interface TeamSkillGap {
  id: string;
  organization_id: string;
  tool_name: string;
  gap_type: SkillGapType;
  severity: "info" | "warning" | "critical";
  description: string;
  data_context: Record<string, unknown>;
  detected_at: string;
  resolved_at: string | null;
}
