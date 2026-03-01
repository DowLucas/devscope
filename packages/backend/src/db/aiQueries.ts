import type { SQL } from "bun";
import type {
  AiConversation,
  AiMessage,
  AiInsight,
  AiReport,
  AiTokenUsage,
  InsightType,
  InsightSeverity,
  ReportStatus,
  ReportType,
} from "@devscope/shared";

// --- Conversations ---

export async function createConversation(
  sql: SQL,
  title: string = "New conversation"
): Promise<AiConversation> {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO ai_conversations (id, title)
    VALUES (${id}, ${title})`;
  const [row] = await sql`SELECT * FROM ai_conversations WHERE id = ${id}`;
  return row as AiConversation;
}

export async function getConversations(
  sql: SQL,
  limit: number = 50
): Promise<AiConversation[]> {
  return (await sql`
    SELECT * FROM ai_conversations
    ORDER BY updated_at DESC
    LIMIT ${limit}`) as AiConversation[];
}

export async function getConversation(
  sql: SQL,
  id: string
): Promise<AiConversation | null> {
  const [row] = await sql`SELECT * FROM ai_conversations WHERE id = ${id}`;
  return (row as AiConversation) ?? null;
}

export async function updateConversationTitle(
  sql: SQL,
  id: string,
  title: string
): Promise<void> {
  await sql`
    UPDATE ai_conversations SET title = ${title}, updated_at = NOW()
    WHERE id = ${id}`;
}

export async function deleteConversation(sql: SQL, id: string): Promise<void> {
  await sql`DELETE FROM ai_conversations WHERE id = ${id}`;
}

export async function touchConversation(sql: SQL, id: string): Promise<void> {
  await sql`UPDATE ai_conversations SET updated_at = NOW() WHERE id = ${id}`;
}

// --- Messages ---

export async function createMessage(
  sql: SQL,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  opts?: {
    toolCalls?: unknown[];
    toolResults?: unknown[];
    tokenCount?: number;
    model?: string;
  }
): Promise<AiMessage> {
  const id = crypto.randomUUID();
  const toolCalls = opts?.toolCalls ? JSON.stringify(opts.toolCalls) : null;
  const toolResults = opts?.toolResults
    ? JSON.stringify(opts.toolResults)
    : null;
  const tokenCount = opts?.tokenCount ?? 0;
  const model = opts?.model ?? null;

  await sql`
    INSERT INTO ai_messages (id, conversation_id, role, content, tool_calls, tool_results, token_count, model)
    VALUES (${id}, ${conversationId}, ${role}, ${content},
      ${toolCalls ? sql`${toolCalls}::JSONB` : sql`NULL`},
      ${toolResults ? sql`${toolResults}::JSONB` : sql`NULL`},
      ${tokenCount}, ${model})`;

  await touchConversation(sql, conversationId);
  const [row] = await sql`SELECT * FROM ai_messages WHERE id = ${id}`;
  return row as AiMessage;
}

export async function getConversationMessages(
  sql: SQL,
  conversationId: string
): Promise<AiMessage[]> {
  return (await sql`
    SELECT * FROM ai_messages
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at ASC`) as AiMessage[];
}

// --- Insights ---

export async function createInsight(
  sql: SQL,
  insight: {
    type: InsightType;
    severity: InsightSeverity;
    title: string;
    narrative: string;
    data_context?: Record<string, unknown>;
    source?: string;
    expires_at?: string;
  }
): Promise<AiInsight> {
  const id = crypto.randomUUID();
  const dataContext = JSON.stringify(insight.data_context ?? {});
  const source = insight.source ?? "automated";
  const expiresAt = insight.expires_at ?? null;

  await sql`
    INSERT INTO ai_insights (id, type, severity, title, narrative, data_context, source, expires_at)
    VALUES (${id}, ${insight.type}, ${insight.severity}, ${insight.title}, ${insight.narrative},
      ${dataContext}::JSONB, ${source}, ${expiresAt ? sql`${expiresAt}::TIMESTAMPTZ` : sql`NULL`})`;

  const [row] = await sql`SELECT * FROM ai_insights WHERE id = ${id}`;
  return row as AiInsight;
}

export async function getInsights(
  sql: SQL,
  opts?: { type?: InsightType; severity?: InsightSeverity; limit?: number }
): Promise<AiInsight[]> {
  const limit = opts?.limit ?? 50;

  if (opts?.type && opts?.severity) {
    return (await sql`
      SELECT * FROM ai_insights
      WHERE type = ${opts.type} AND severity = ${opts.severity}
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT ${limit}`) as AiInsight[];
  }
  if (opts?.type) {
    return (await sql`
      SELECT * FROM ai_insights
      WHERE type = ${opts.type}
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT ${limit}`) as AiInsight[];
  }
  if (opts?.severity) {
    return (await sql`
      SELECT * FROM ai_insights
      WHERE severity = ${opts.severity}
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT ${limit}`) as AiInsight[];
  }
  return (await sql`
    SELECT * FROM ai_insights
    WHERE expires_at IS NULL OR expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT ${limit}`) as AiInsight[];
}

export async function cleanupExpiredInsights(sql: SQL): Promise<number> {
  const result = await sql`
    DELETE FROM ai_insights WHERE expires_at IS NOT NULL AND expires_at <= NOW()`;
  return (result as any).count ?? 0;
}

// --- Reports ---

export async function createReport(
  sql: SQL,
  report: {
    report_type: ReportType;
    title: string;
    period_start?: string;
    period_end?: string;
  }
): Promise<AiReport> {
  const id = crypto.randomUUID();
  const periodStart = report.period_start ?? null;
  const periodEnd = report.period_end ?? null;

  await sql`
    INSERT INTO ai_reports (id, report_type, title, status, period_start, period_end)
    VALUES (${id}, ${report.report_type}, ${report.title}, 'generating',
      ${periodStart ? sql`${periodStart}::TIMESTAMPTZ` : sql`NULL`},
      ${periodEnd ? sql`${periodEnd}::TIMESTAMPTZ` : sql`NULL`})`;

  const [row] = await sql`SELECT * FROM ai_reports WHERE id = ${id}`;
  return row as AiReport;
}

export async function updateReport(
  sql: SQL,
  id: string,
  updates: {
    content_markdown?: string;
    data_context?: Record<string, unknown>;
    status?: ReportStatus;
  }
): Promise<void> {
  if (updates.content_markdown !== undefined) {
    await sql`UPDATE ai_reports SET content_markdown = ${updates.content_markdown} WHERE id = ${id}`;
  }
  if (updates.data_context !== undefined) {
    const ctx = JSON.stringify(updates.data_context);
    await sql`UPDATE ai_reports SET data_context = ${ctx}::JSONB WHERE id = ${id}`;
  }
  if (updates.status !== undefined) {
    await sql`UPDATE ai_reports SET status = ${updates.status} WHERE id = ${id}`;
  }
}

export async function getReports(
  sql: SQL,
  limit: number = 20
): Promise<AiReport[]> {
  return (await sql`
    SELECT * FROM ai_reports
    ORDER BY created_at DESC
    LIMIT ${limit}`) as AiReport[];
}

export async function getReport(
  sql: SQL,
  id: string
): Promise<AiReport | null> {
  const [row] = await sql`SELECT * FROM ai_reports WHERE id = ${id}`;
  return (row as AiReport) ?? null;
}

// --- Token Usage ---

export async function recordTokenUsage(
  sql: SQL,
  source: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO ai_token_usage (id, source, model, input_tokens, output_tokens)
    VALUES (${id}, ${source}, ${model}, ${inputTokens}, ${outputTokens})`;
}

export async function getTokenUsageSummary(
  sql: SQL,
  days: number = 30
): Promise<{
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  by_source: { source: string; input_tokens: number; output_tokens: number }[];
}> {
  const [totals] = await sql`
    SELECT
      COALESCE(SUM(input_tokens), 0)::INT as total_input_tokens,
      COALESCE(SUM(output_tokens), 0)::INT as total_output_tokens,
      COALESCE(SUM(input_tokens + output_tokens), 0)::INT as total_tokens
    FROM ai_token_usage
    WHERE created_at >= NOW() - make_interval(days => ${days})`;

  const bySource = await sql`
    SELECT
      source,
      SUM(input_tokens)::INT as input_tokens,
      SUM(output_tokens)::INT as output_tokens
    FROM ai_token_usage
    WHERE created_at >= NOW() - make_interval(days => ${days})
    GROUP BY source
    ORDER BY SUM(input_tokens + output_tokens) DESC`;

  return {
    total_input_tokens: (totals as any)?.total_input_tokens ?? 0,
    total_output_tokens: (totals as any)?.total_output_tokens ?? 0,
    total_tokens: (totals as any)?.total_tokens ?? 0,
    by_source: bySource as any[],
  };
}

export async function getTodayTokenCount(sql: SQL): Promise<number> {
  const [row] = await sql`
    SELECT COALESCE(SUM(input_tokens + output_tokens), 0)::INT as total
    FROM ai_token_usage
    WHERE created_at::DATE = CURRENT_DATE`;
  return (row as any)?.total ?? 0;
}
