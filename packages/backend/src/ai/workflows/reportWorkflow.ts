import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { callGemini, TEMPERATURE } from "../gemini";
import {
  getPeriodComparison,
  getTeamHealth,
  getTeamActivitySummary,
  getProjectsOverview,
  getToolUsageBreakdown,
  getSessionStatsSummary,
  getFailureClusters,
  getPatterns,
  getAntiPatternStats,
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

  // Team-level aggregate data only — no individual developer data sent to LLM.
  const [
    periodComparison,
    teamHealth,
    teamActivity,
    projects,
    toolUsage,
    sessionSummary,
    failureClusters,
    effectivePatterns,
    antiPatternSummary,
  ] = await Promise.all([
    getPeriodComparison(sql, days, undefined, devIds),
    getTeamHealth(sql, devIds),
    getTeamActivitySummary(sql, days, devIds),
    getProjectsOverview(sql, days, devIds),
    getToolUsageBreakdown(sql, undefined, days, devIds),
    getSessionStatsSummary(sql, undefined, days, devIds),
    getFailureClusters(sql, days, devIds),
    getPatterns(sql, { effectiveness: "effective", limit: 10 }),
    getAntiPatternStats(sql, days),
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
      // Only include aggregate team health data — not individual developer entries
      teamVelocity: teamHealth.velocity,
      sessionsNeedingAttention: teamHealth.sessionsNeedingAttention,
      teamActivity,
      projects,
      toolUsage,
      sessionSummary,
      failureClusters,
      effectivePatterns,
      antiPatternSummary,
    },
    reportId: report.id,
  };
}

async function generateOutline(
  state: ReportStateType
): Promise<Partial<ReportStateType>> {
  const dataStr = JSON.stringify(state.data, null, 2).slice(0, 25_000);

  const personaMap: Record<string, string> = {
    "team-lead": "Team Lead — focus on project progress, blockers, tool issues, and team velocity trends.",
    "developer": "Developer — focus on tool adoption, failure patterns, and project health. Practical and actionable.",
    "executive": "Executive/CTO — focus on AI tool ROI, team capacity trends, strategic recommendations for AI adoption, and cost-per-prompt efficiency. High-level, strategic framing.",
    "investor": "Investor/Board — focus on quantifiable AI adoption metrics, team throughput benchmarks, operational efficiency gains. Format for inclusion in board-level reporting. Include period-over-period deltas and trend lines.",
  };
  const personaGuidance = state.persona
    ? `\n\nAudience: ${personaMap[state.persona] ?? personaMap["team-lead"]}`
    : "";

  const response = await callGemini(
    [
      {
        role: "user",
        parts: [
          {
            text: `You are creating a team report for DevScope, a developer workflow analytics platform.
Report type: ${state.reportType}
Title: ${state.title}${personaGuidance}

IMPORTANT: This report should focus on TEAM-LEVEL metrics only. Do NOT include individual developer names, rankings, or performance comparisons. Focus on:
- Team Claude Code usage trends (sessions, completion rates, feature adoption)
- Project health and progress
- Claude Code usage patterns (which features are being leveraged effectively?)
- Sessions with high failure rates (what prompting strategies could help?)
- Claude Code Skills: effective developer strategies, common usage pitfalls, and tips for getting better results from Claude Code

Based on this data, create a detailed outline for the report. Include a "Claude Code Skills" section.

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

  const personaReqMap: Record<string, string> = {
    "team-lead": "a Team Lead audience: focus on project progress, blockers, team velocity trends, and tool issues",
    "developer": "a Developer audience: focus on tool adoption patterns, failure analysis, and practical recommendations",
    "executive": "an Executive audience: lead with ROI and strategic impact. Include AI maturity score trend, cost efficiency metrics, and strategic recommendations. Use professional, concise language suitable for C-suite",
    "investor": "an Investor/Board audience: lead with quantifiable metrics and period-over-period deltas. Include AI adoption benchmarks, operational efficiency gains, and team capacity utilization. Format for board deck inclusion with clear data points",
  };
  const personaRequirements = state.persona
    ? `\n- Tailored for ${personaReqMap[state.persona] ?? personaReqMap["team-lead"]}`
    : "";

  const response = await callGemini(
    [
      {
        role: "user",
        parts: [
          {
            text: `Write a polished team report in Markdown based on this outline and data.

Report type: ${state.reportType}
Title: ${state.title}

Outline:
${state.outline}

Data:
${dataStr}

Requirements:
- Use proper Markdown with headers (##, ###), bullet points, and bold for emphasis
- Include specific numbers and percentages from the provided data ONLY. Do not fabricate or estimate metrics that are not present — if data is unavailable, state "insufficient data" instead
- Start with a Summary section
- Include sections for: Team Usage Overview, Project Health, Claude Code Effectiveness, Developer Strategies, Sessions Needing Attention, Recommendations
- In the Developer Strategies section: highlight top effective developer approaches with success rates, flag common usage pitfalls with frequency and tips for improvement, and provide 2-3 concrete Claude Code usage tips based on the data (e.g. "Sessions where developers explored the codebase first had fewer failures — try asking Claude to research before editing")
- End with Action Items focused on improving Claude Code usage and developer workflow
- NEVER include individual developer names, rankings, or performance comparisons
- Focus on team-level patterns, not individual behavior
- Keep the tone collaborative — this is about helping the team use Claude Code more effectively, not evaluating individuals
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
