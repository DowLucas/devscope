import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { callGemini, TEMPERATURE } from "../gemini";
import { validateAndRedactTeamOutput } from "../grounding/validator";
import { guardWeeklyReportInput } from "../grounding/missionGuardrail";
import {
  getPeriodComparison,
  getTeamHealth,
  getTeamActivitySummary,
  getProjectsOverview,
  getToolUsageBreakdown,
  getConcreteToolDetails,
  getSessionStatsSummary,
  getFailureClusters,
  getPatterns,
  getAntiPatternStats,
  recordTokenUsage,
  createReport,
  updateReport,
  getDocGapsForOrg,
} from "../../db";
import type { AiReport, ReportType } from "@devscope/shared";

const ReportState = Annotation.Root({
  reportType: Annotation<ReportType>,
  title: Annotation<string>,
  periodStart: Annotation<string | null>,
  periodEnd: Annotation<string | null>,
  persona: Annotation<string | null>,
  developerIds: Annotation<string[] | undefined>,
  orgId: Annotation<string>,
  data: Annotation<Record<string, unknown>>,
  outline: Annotation<string>,
  content: Annotation<string>,
  reportId: Annotation<string>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
});

type ReportStateType = typeof ReportState.State;

/**
 * Persona key for the Friday-narrative weekly team report we hand to a design
 * partner. The branch is intentionally additive — it does not touch the
 * `team-lead` / `developer` paths. See parent task DEV-39.
 */
export const WEEKLY_BUYER_PERSONA = "weekly-buyer" as const;

/**
 * Build the outline-generation prompt for the `weekly-buyer` persona.
 *
 * Exposed as a pure helper so the snapshot test can assert the rendered
 * template carries zero developer-identifying tokens (names, emails, hashes)
 * without actually calling the LLM.
 */
export function buildWeeklyBuyerOutlinePrompt(args: {
  reportType: ReportType;
  title: string;
  data: Record<string, unknown>;
}): string {
  const dataStr = JSON.stringify(args.data, null, 2).slice(0, 25_000);

  return `You are drafting the weekly Friday-narrative team report for DevScope.
The reader is an external design partner — buyer-legible, not internal engineering jargon.

Report type: ${args.reportType}
Title: ${args.title}

Voice & framing:
- Friday-narrative: "this week the team worked on X. What worked: Y. What didn't: Z. Where they got stuck: W. Versus last week, the shift was V."
- TEAM-AGGREGATE ONLY. Never mention individual developers — no names, no emails, no SHA hashes, no "Developer A/B", no "this developer", no per-person counts, no rankings or comparisons across people.
- Concise and buyer-legible. Cut DevScope-internal jargon.

Outline a ~500-word narrative with these sections, in order:
1. Week summary (one short paragraph framing the week at a team level)
2. What worked (up to 3 bullets, team-level only)
3. What didn't (up to 3 bullets, team-level only)
4. Where the team got stuck (failure clusters, project blockers — attribute to tools, projects, or sessions, never to individuals)
5. Documentation gaps (recurring missing project context where Claude Code lacked knowledge — sourced from the \`docGaps\` field on the data when present; if absent or empty, say "Doc gap data unavailable for this period." — do not fabricate gaps)
6. Week-over-week (use \`periodComparison\`; describe direction and magnitude in plain language)

Data:
${dataStr}

Return a structured outline with the sections above. Keep it tight.`;
}

/**
 * Build the report-writing prompt for the `weekly-buyer` persona.
 *
 * Like the outline helper, exported so the snapshot test can validate the
 * rendered template against the team-aggregate guardrail without invoking
 * the LLM.
 */
export function buildWeeklyBuyerWritePrompt(args: {
  reportType: ReportType;
  title: string;
  outline: string;
  data: Record<string, unknown>;
}): string {
  const dataStr = JSON.stringify(args.data, null, 2).slice(0, 25_000);

  return `Write the weekly Friday-narrative team report in Markdown. The audience is an external design partner.

Report type: ${args.reportType}
Title: ${args.title}

Outline:
${args.outline}

Data:
${dataStr}

Requirements:
- Voice: Friday-narrative — "this week the team…", "what worked", "what didn't", "where they got stuck", "versus last week".
- TEAM-AGGREGATE ONLY: never reference individuals. Do not include names, emails, SHA hashes, "Developer A/B", "this developer", per-person counts, or per-developer rankings or comparisons.
- Use specific numbers and percentages from the provided data ONLY. If a figure is not in the data, say "insufficient data" — do not estimate or invent.
- Sections, in order: "Week summary", "What worked", "What didn't", "Where the team got stuck", "Documentation gaps", "Week-over-week".
- Documentation gaps subsection: list recurring missing project context where Claude Code lacked knowledge, sourced from the \`docGaps\` field on the data if present. If \`docGaps\` is missing or empty, write exactly: "Doc gap data unavailable for this period." — do not fabricate gaps.
- Length: 400–700 words. Concise, buyer-legible, no DevScope-internal jargon, no instructions to the team — this is an artifact for an external reader.
- Do NOT include "Action Items", "Improve Your Claude Code Setup", or "Claude Code Skills" sections — those are for internal personas only.`;
}

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

/**
 * Exported for the DEV-45 mission-guardrail snapshot test, which exercises
 * the helper-layer composition with a synthetic team to prove the LLM input
 * payload contains zero developer-identifying strings. Not part of the
 * stable public API.
 */
export async function gatherReportData(
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
    concreteDetails,
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
    getConcreteToolDetails(sql, days, devIds),
    getSessionStatsSummary(sql, undefined, days, devIds),
    getFailureClusters(sql, days, devIds),
    getPatterns(sql, { effectiveness: "effective", limit: 10 }),
    getAntiPatternStats(sql, days),
  ]);

  // Create the report record. orgId is required (DEV-43): every report row
  // must be tenant-scoped at the DB layer to support the weekly-cron dedup
  // index and to prevent cross-org reads.
  const report = await createReport(sql, {
    report_type: state.reportType,
    title: state.title,
    period_start: state.periodStart ?? undefined,
    period_end: state.periodEnd ?? undefined,
    orgId: state.orgId,
  });

  // DEV-48 doc-gap subsection — only computed for the weekly-buyer persona
  // because the prompt slot lives on that persona only. Resolved here so the
  // mission guardrail tripwire in `generateOutline` covers the full payload.
  // If the helper has nothing to report (no CLAUDE.md snapshots, no period
  // bounds, or no candidate terms), the field is omitted and the prompt's
  // "Doc gap data unavailable" branch handles the absence gracefully.
  let docGaps: Awaited<ReturnType<typeof getDocGapsForOrg>> | undefined;
  if (
    state.persona === WEEKLY_BUYER_PERSONA &&
    state.periodStart &&
    state.periodEnd &&
    state.orgId
  ) {
    docGaps = await getDocGapsForOrg(sql, state.orgId, {
      start: state.periodStart,
      end: state.periodEnd,
    });
  }

  return {
    data: {
      periodComparison,
      // Only include aggregate team health data — not individual developer entries
      teamVelocity: teamHealth.velocity,
      sessionsNeedingAttention: teamHealth.sessionsNeedingAttention,
      teamActivity,
      projects,
      toolUsage,
      concreteToolDetails: concreteDetails,
      sessionSummary,
      failureClusters,
      effectivePatterns,
      antiPatternSummary,
      ...(docGaps && docGaps.length > 0 ? { docGaps } : {}),
    },
    reportId: report.id,
  };
}

async function generateOutline(
  state: ReportStateType,
  sql: SQL
): Promise<Partial<ReportStateType>> {
  // Additive branch for the weekly Friday-narrative buyer report. The standard
  // path below is untouched.
  if (state.persona === WEEKLY_BUYER_PERSONA) {
    // DEV-45 mission guardrail: tripwire + audit-log on every LLM input from
    // the weekly-buyer surface. Throws BEFORE the LLM call if any developer
    // identity sneaks through, per the DEV-37 kill criteria.
    await guardWeeklyReportInput(sql, state.data, {
      organizationId: state.orgId ?? null,
      persona: WEEKLY_BUYER_PERSONA,
      periodStart: state.periodStart,
      periodEnd: state.periodEnd,
      surface: "reports.weekly-buyer.outline",
    });

    const response = await callGemini(
      [
        {
          role: "user",
          parts: [
            {
              text: buildWeeklyBuyerOutlinePrompt({
                reportType: state.reportType,
                title: state.title,
                data: state.data,
              }),
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
- Team Claude Code usage trends (sessions, completion rates, feature adoption)
- Project health and progress
- CONCRETE tool usage: reference specific bash commands (git, npm, docker), specific files accessed (package.json, tsconfig.json), specific search patterns, and specific directories explored from the concreteToolDetails data
- Sessions with high failure rates (what prompting strategies could help?)
- Claude Code Skills: effective developer strategies, common usage pitfalls, and tips for getting better results from Claude Code

IMPORTANT: When discussing tool usage, ALWAYS use specific details from concreteToolDetails rather than generic labels like "Bash-heavy" or "Read-Edit loops". Say "git commands (120x), npm scripts (45x)" not "Bash tool (165x)".

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
  // Additive branch for the weekly Friday-narrative buyer report. The standard
  // path below is untouched.
  if (state.persona === WEEKLY_BUYER_PERSONA) {
    // DEV-45 mission guardrail: re-assert + audit on the write step. The data
    // has not changed since the outline step, but re-asserting here means a
    // hypothetical inline mutation between nodes still cannot reach the LLM,
    // and the audit log captures both LLM dispatches per kill-criteria.
    await guardWeeklyReportInput(sql, state.data, {
      organizationId: state.orgId ?? null,
      persona: WEEKLY_BUYER_PERSONA,
      periodStart: state.periodStart,
      periodEnd: state.periodEnd,
      surface: "reports.weekly-buyer.write",
    });

    const response = await callGemini(
      [
        {
          role: "user",
          parts: [
            {
              text: buildWeeklyBuyerWritePrompt({
                reportType: state.reportType,
                title: state.title,
                outline: state.outline,
                data: state.data,
              }),
            },
          ],
        },
      ],
      undefined,
      { temperature: TEMPERATURE.report, maxOutputTokens: 4096 }
    );

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
- Include specific numbers and percentages from the provided data ONLY. Do not fabricate or estimate metrics that are not present — if data is unavailable, state "insufficient data" instead
- Start with a Summary section
- Include sections for: Team Usage Overview, Project Health, Claude Code Effectiveness, Developer Strategies, Sessions Needing Attention, Recommendations
- CRITICAL: When discussing tool usage, reference SPECIFIC details from concreteToolDetails:
  - Name actual bash commands and their counts (e.g. "git (120x), npm (45x), docker (8x)") instead of "Bash tool (173x)"
  - Name actual files accessed (e.g. "package.json (25x), tsconfig.json (15x)") instead of "Read tool (40x)"
  - Name actual search patterns used (e.g. "export.*function, TODO, fixme") instead of "Grep tool (30x)"
  - Name actual directories explored instead of "Glob tool"
  - Name actual skills/slash commands used instead of "Skill tool"
- In the Developer Strategies section: highlight top effective developer approaches with success rates, flag common usage pitfalls with frequency and tips for improvement, and provide 2-3 concrete Claude Code usage tips based on the data
- Include an **"Improve Your Claude Code Setup"** section with: (a) 2-3 specific CLAUDE.md additions the team should make based on observed failure patterns and context gaps (show each suggestion as a markdown code block with the text to add), (b) 1-2 Claude Code skill definitions based on effective repeated patterns observed (show the skill body in a code block), (c) any recurring context gaps where Claude Code repeatedly lacked project knowledge
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

  // DEV-30 / M2: validate the full report before persisting. Reports are the
  // most likely place for the model to drift into per-dev language because the
  // outline + write step can re-introduce names from data even if the prompt
  // forbids it. Use a report-shaped fallback so a rejected report still has
  // some useful framing instead of a one-line refusal.
  const grounded = await validateAndRedactTeamOutput(sql, response.text, {
    surface: "reports",
    fallback:
      "## Report suppressed\n\n" +
      "This report was suppressed because its draft content referenced individual " +
      "developers. DevScope only surfaces team-level metrics. Please re-run the " +
      "report — if this keeps happening, the underlying prompt may need to be " +
      "tightened (file an issue).",
  });

  // Update the report in DB
  await updateReport(sql, state.reportId, {
    content_markdown: grounded.text,
    data_context: state.data,
    status: "completed",
  });

  return {
    content: grounded.text,
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

export function createReportWorkflow(sql: SQL) {
  const workflow = new StateGraph(ReportState)
    .addNode("gatherReportData", (state) => gatherReportData(state, sql))
    .addNode("generateOutline", (state) => generateOutline(state, sql))
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
  orgId: string,
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
    orgId,
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
