// --- AI BI Layer Types ---

export type InsightType = "anomaly" | "trend" | "comparison" | "recommendation";
export type InsightSeverity = "info" | "warning" | "critical";
export type ReportStatus = "generating" | "completed" | "failed";
export type ReportType = "daily" | "weekly" | "custom";

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

// --- WebSocket message types ---

export type AiWsMessageType = "ai.insight.new" | "ai.report.completed";
