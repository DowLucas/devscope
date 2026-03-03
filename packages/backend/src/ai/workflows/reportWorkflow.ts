import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { callGemini, TEMPERATURE } from "../gemini";
import {
  getPeriodComparison,
  getTeamHealth,
  getDeveloperLeaderboard,
  getProjectsOverview,
  getToolUsageBreakdown,
  getSessionStatsSummary,
  getFailureClusters,
} from "../../db";
import {
  recordTokenUsage,
  createReport,
  updateReport,
} from "../../db";
import type { AiReport, ReportType } from "@devscope/shared";

const ReportState = Annotation.Root({
  reportType: Annotation<ReportType>,
  title: Annotation<string>,
  periodStart: Annotation<string | null>,
  periodEnd: Annotation<string | null>,
  persona: Annotation<string | null>,
  developerIds: Annotation<string[] | undefined>,
  data: Annotation<Record<string, unknown>>,
  outline: Annotation<string>,
  content: Annotation<string>,
  reportId: Annotation<string>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
});

type ReportStateType = typeof ReportState.State;

function getDaysForType(reportType: ReportType): number {
  switch (reportType) {
    case "daily":
      return 1;
    case "weekly":
      return 7;
    default:
      return 30;
  }
}

async function gatherReportData(
  state: ReportStateType,
  sql: SQL
): Promise<Partial<ReportStateType>> {
  const days = getDaysForType(state.reportType);
  const devIds = state.developerIds;

  const [
    periodComparison,
    teamHealth,
    leaderboard,
    projects,
    toolUsage,
    sessionSummary,
    failureClusters,
  ] = await Promise.all([
    getPeriodComparison(sql, days, undefined, devIds),
    getTeamHealth(sql, devIds),
    getDeveloperLeaderboard(sql, days, devIds),
    getProjectsOverview(sql, days, devIds),
    getToolUsageBreakdown(sql, undefined, days, devIds),
    getSessionStatsSummary(sql, undefined, days, devIds),
    getFailureClusters(sql, days, devIds),
  ]);

  // Create the report record
  const report = await createReport(sql, {
    report_type: state.reportType,
    title: state.title,
    period_start: state.periodStart ?? undefined,
    period_end: state.periodEnd ?? undefined,
  });

  return {
    data: {
      periodComparison,
      teamHealth,
      leaderboard,
      projects,
      toolUsage,
      sessionSummary,
      failureClusters,
    },
    reportId: report.id,
  };
}

async function generateOutline(
  state: ReportStateType
): Promise<Partial<ReportStateType>> {
  const dataStr = JSON.stringify(state.data, null, 2).slice(0, 25_000);

  const personaGuidance = state.persona
    ? `\n\nAudience: ${state.persona === "ceo" ? "CEO — focus on 3-4 top-level KPIs, traffic light status, and one-sentence explanations. Keep it extremely concise." : state.persona === "cto" ? "CTO — include ROI metrics, project allocation, adoption and efficiency data. Board-ready language." : "Engineering Manager — operational focus with team velocity, burnout risk signals, stuck sessions, and failure clusters."}`
    : "";

  const response = await callGemini(
    [
      {
        role: "user",
        parts: [
          {
            text: `You are creating an executive report for DevScope, a developer activity monitoring platform.
Report type: ${state.reportType}
Title: ${state.title}${personaGuidance}

Based on this data, create a detailed outline for the report. Include section headings, key points for each section, and the most important metrics to highlight.

Data:
${dataStr}

Return a structured outline with sections. Keep it concise.`,
          },
        ],
      },
    ],
    undefined,
    { temperature: TEMPERATURE.report }
  );

  return {
    outline: response.text,
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

async function writeReport(
  state: ReportStateType,
  sql: SQL
): Promise<Partial<ReportStateType>> {
  const dataStr = JSON.stringify(state.data, null, 2).slice(0, 25_000);

  const personaRequirements = state.persona
    ? `\n- Tailored for ${state.persona === "ceo" ? "a CEO audience: ultra-concise, 3-4 KPIs with status indicators, no technical jargon" : state.persona === "cto" ? "a CTO audience: include AI ROI metrics, project allocation, adoption vs efficiency data, board-ready language" : "an Engineering Manager audience: operational focus, team velocity trends, burnout risk signals, stuck sessions, failure patterns"}`
    : "";

  const response = await callGemini(
    [
      {
        role: "user",
        parts: [
          {
            text: `Write a polished executive report in Markdown based on this outline and data.

Report type: ${state.reportType}
Title: ${state.title}

Outline:
${state.outline}

Data:
${dataStr}

Requirements:
- Use proper Markdown with headers (##, ###), bullet points, and bold for emphasis
- Include specific numbers and percentages
- Start with an Executive Summary section
- Include sections for: Key Metrics, Developer Activity, Project Health, Tool Performance, Risks & Recommendations
- End with Action Items
- Keep the tone professional but accessible
- Highlight both wins and areas for improvement
- Total length: 500-1500 words${personaRequirements}`,
          },
        ],
      },
    ],
    undefined,
    { temperature: TEMPERATURE.report, maxOutputTokens: 4096 }
  );

  // Update the report in DB
  await updateReport(sql, state.reportId, {
    content_markdown: response.text,
    data_context: state.data,
    status: "completed",
  });

  return {
    content: response.text,
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

export function createReportWorkflow(sql: SQL) {
  const workflow = new StateGraph(ReportState)
    .addNode("gatherReportData", (state) => gatherReportData(state, sql))
    .addNode("generateOutline", generateOutline)
    .addNode("writeReport", (state) => writeReport(state, sql))
    .addEdge(START, "gatherReportData")
    .addEdge("gatherReportData", "generateOutline")
    .addEdge("generateOutline", "writeReport")
    .addEdge("writeReport", END);

  return workflow.compile();
}

export async function runReportWorkflow(
  sql: SQL,
  reportType: ReportType,
  title?: string,
  periodStart?: string,
  periodEnd?: string,
  persona?: string,
  developerIds?: string[]
): Promise<AiReport> {
  const reportTitle =
    title ??
    `${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report — ${new Date().toLocaleDateString()}`;

  const app = createReportWorkflow(sql);

  const result = await app.invoke({
    reportType,
    title: reportTitle,
    periodStart: periodStart ?? null,
    periodEnd: periodEnd ?? null,
    persona: persona ?? null,
    developerIds,
    data: {},
    outline: "",
    content: "",
    reportId: "",
    inputTokens: 0,
    outputTokens: 0,
  });

  await recordTokenUsage(
    sql,
    "report",
    "gemini-2.0-flash",
    result.inputTokens,
    result.outputTokens
  );

  // Fetch the completed report
  const [report] = await sql`SELECT * FROM ai_reports WHERE id = ${result.reportId}`;
  return report as AiReport;
}
