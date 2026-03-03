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

  const personaGuidance = state.persona
    ? `\n\nAudience: ${state.persona === "team-lead" ? "Team Lead — focus on project progress, blockers, tool issues, and team velocity trends." : state.persona === "developer" ? "Developer — focus on tool adoption, failure patterns, and project health. Practical and actionable." : "Team Lead — focus on project progress, blockers, tool issues, and team velocity trends."}`
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
- Team velocity trends (sessions, prompts, tool calls)
- Project health and progress
- Tool adoption and failure patterns (which tools need fixing?)
- Sessions with high failure rates (tooling problems, not people problems)
- Skills & Patterns: effective workflow patterns the team uses well, common anti-patterns to avoid, and coaching suggestions

Based on this data, create a detailed outline for the report. Include a "Skills & Patterns" section.

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
    ? `\n- Tailored for ${state.persona === "team-lead" ? "a Team Lead audience: focus on project progress, blockers, team velocity trends, and tool issues" : state.persona === "developer" ? "a Developer audience: focus on tool adoption patterns, failure analysis, and practical recommendations" : "a Team Lead audience: focus on project progress, blockers, team velocity trends, and tool issues"}`
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
- Include specific numbers and percentages
- Start with a Summary section
- Include sections for: Team Velocity, Project Health, Tool Performance, Skills & Patterns, Sessions Needing Attention, Recommendations
- In the Skills & Patterns section: highlight top effective workflow patterns with success rates, flag common anti-patterns with frequency and avoidance tips, and provide 2-3 concrete coaching suggestions based on the data (e.g. "Sessions that used Read before Edit had fewer failures")
- End with Action Items focused on improving tooling and workflow
- NEVER include individual developer names, rankings, or performance comparisons
- Focus on team-level patterns, not individual behavior
- Keep the tone collaborative — this is about improving team workflow, not evaluating individuals
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
