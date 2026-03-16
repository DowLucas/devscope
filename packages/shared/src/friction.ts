export type FrictionRuleType =
  | "repeated_failure"
  | "escalating_prompts"
  | "no_progress"
  | "failure_cascade"
  | "stuck_loop";

export interface FrictionRule {
  id: string;
  organization_id: string | null;
  rule_name: string;
  rule_type: FrictionRuleType;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

export interface FrictionAlert {
  id: string;
  organization_id: string | null;
  session_id: string;
  developer_id: string;
  rule_id: string | null;
  rule_type: FrictionRuleType;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  data_context: Record<string, unknown>;
  acknowledged: boolean;
  triggered_at: string;
}
