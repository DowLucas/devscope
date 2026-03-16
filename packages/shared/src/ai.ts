// --- AI BI Layer Types ---

export type InsightType = "anomaly" | "trend" | "comparison" | "recommendation" | "coaching";
export type InsightSeverity = "info" | "warning" | "critical";
export type ReportStatus = "generating" | "completed" | "failed";
export type ReportType = "daily" | "weekly" | "custom" | "session";

export interface AiConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AiMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls: AiToolCall[] | null;
  tool_results: AiToolResult[] | null;
  token_count: number;
  model: string | null;
  created_at: string;
}

export interface AiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AiToolResult {
  tool_call_id: string;
  name: string;
  result: unknown;
}

export interface AiInsight {
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  narrative: string;
  data_context: Record<string, unknown>;
  source: string;
  expires_at: string | null;
  created_at: string;
}

export interface AiReport {
  id: string;
  report_type: ReportType;
  title: string;
  content_markdown: string;
  data_context: Record<string, unknown>;
  status: ReportStatus;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
}

export interface AiTokenUsage {
  id: string;
  source: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

// --- Request/Response types ---

export interface AiQueryRequest {
  question: string;
  conversation_id?: string;
}

export interface AiQueryResponse {
  conversation_id: string;
  message_id: string;
  content: string;
  tool_calls?: AiToolCall[];
}

export interface AiReportGenerateRequest {
  report_type: ReportType;
  title?: string;
  period_start?: string;
  period_end?: string;
}

// --- Upskilling Platform Types ---

export type PatternEffectiveness = "effective" | "neutral" | "ineffective";
export type AntiPatternRule = "retry_loop" | "failure_cascade" | "abandoned_session" | "ai_detected";
export type AntiPatternSeverity = "info" | "warning" | "critical";
export type PlaybookStatus = "active" | "draft" | "archived";

export interface SessionPattern {
  id: string;
  name: string;
  description: string;
  tool_sequence: string[];
  avg_success_rate: number;
  occurrence_count: number;
  effectiveness: PatternEffectiveness;
  category: string | null;
  data_context: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SessionPatternMatch {
  id: string;
  session_id: string;
  pattern_id: string;
  match_confidence: number;
  tool_success_rate: number | null;
  created_at: string;
}

export interface AntiPattern {
  id: string;
  name: string;
  description: string;
  detection_rule: AntiPatternRule;
  severity: AntiPatternSeverity;
  suggestion: string;
  occurrence_count: number;
  data_context: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SessionAntiPatternMatch {
  id: string;
  session_id: string;
  anti_pattern_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  tool_sequence: string[];
  when_to_use: string;
  success_metrics: Record<string, unknown>;
  source_pattern_id: string | null;
  status: PlaybookStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// --- Team Skills Types ---

export type TeamSkillStatus = "draft" | "approved" | "active" | "archived";

export interface TeamSkill {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  trigger_phrases: string[];
  skill_body: string;
  source_pattern_ids: string[];
  source_anti_pattern_ids: string[];
  version: number;
  previous_version_id: string | null;
  generation_context: Record<string, unknown>;
  status: TeamSkillStatus;
  approved_by: string | null;
  approved_at: string | null;
  effectiveness_score: number | null;
  adoption_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TeamSkillPatternLink {
  id: string;
  skill_id: string;
  pattern_id: string | null;
  anti_pattern_id: string | null;
  link_type: "source_pattern" | "anti_pattern_solution";
  created_at: string;
}

export interface TeamSkillStats {
  total: number;
  draft: number;
  approved: number;
  active: number;
  archived: number;
  avg_effectiveness: number | null;
}

// --- WebSocket message types ---

export type AiWsMessageType =
  | "ai.insight.new"
  | "ai.report.completed"
  | "ai.pattern.new"
  | "ai.antipattern.new"
  | "ai.playbook.new"
  | "ai.skill.new"
  | "ai.skill.updated";
