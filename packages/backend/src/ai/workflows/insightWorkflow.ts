import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { callGemini, TEMPERATURE } from "../gemini";
import {
  getPeriodComparison,
  getTeamHealth,
  getFailureClusters,
  getTeamActivitySummary,
  getProjectsOverview,
} from "../../db";
import { recordTokenUsage, createInsight } from "../../db";
import type { AiInsight, InsightType, InsightSeverity } from "@devscope/shared";

interface InsightData {
  periodComparison: unknown;
  teamHealth: unknown;
  failureClusters: unknown;
  teamActivity: unknown;
  projects: unknown;
}

interface DetectedInsight {
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  narrative: string;
}

const InsightState = Annotation.Root({
  days: Annotation<number>,
  data: Annotation<InsightData>,
  insights: Annotation<DetectedInsight[]>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
});

type InsightStateType = typeof InsightState.State;

async function gatherData(
  state: InsightStateType,
  sql: SQL
): Promise<Partial<InsightStateType>> {
  const days = state.days;

  const [periodComparison, teamHealth, failureClusters, teamActivity, projects] =
    await Promise.all([
      getPeriodComparison(sql, days),
      getTeamHealth(sql),
      getFailureClusters(sql, days),
      getTeamActivitySummary(sql, days),
      getProjectsOverview(sql, days),
    ]);

  return {
    data: {
      periodComparison,
      teamHealth,
      failureClusters,
      teamActivity,
      projects,
    },
  };
}

const INSIGHT_PROMPT = `You are an expert data analyst for DevScope, a developer activity monitoring platform.
Analyze the following data and identify significant insights. Focus on:
1. Anomalies: unusual spikes or drops in activity, failure rates, or session patterns
2. Trends: week-over-week changes that indicate improving or declining team velocity
3. Tool Health: tools with high failure rates that need attention
4. Recommendations: actionable suggestions for improving team workflow and tooling

IMPORTANT: Focus on team-level patterns only. Do NOT include individual developer names, rankings, or performance comparisons.

For each insight, provide:
- type: one of "anomaly", "trend", "comparison", "recommendation"
- severity: "info" for neutral observations, "warning" for concerning patterns, "critical" for urgent issues
- title: a concise headline (max 80 chars)
- narrative: a 2-3 sentence explanation with specific numbers

Return a JSON array of insights. Return an empty array if nothing significant is found.
Only return meaningful insights — do not force insights where data is unremarkable.

Respond with ONLY valid JSON — no markdown, no code fences, no other text.`;

async function detectAnomalies(
  state: InsightStateType
): Promise<Partial<InsightStateType>> {
  const dataStr = JSON.stringify(state.data, null, 2).slice(0, 30_000);

  const response = await callGemini(
    [
      {
        role: "user",
        parts: [{ text: INSIGHT_PROMPT + "\n\nData:\n" + dataStr }],
      },
    ],
    undefined,
    { temperature: TEMPERATURE.insight }
  );

  let insights: DetectedInsight[] = [];
  try {
    const cleaned = response.text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      insights = parsed.filter(
        (i: any) =>
          i.type && i.severity && i.title && i.narrative
      );
    }
  } catch {
    console.error("[ai-insights] Failed to parse Gemini response:", response.text.slice(0, 200));
  }

  return {
    insights,
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

export function createInsightWorkflow(sql: SQL) {
  const workflow = new StateGraph(InsightState)
    .addNode("gatherData", (state) => gatherData(state, sql))
    .addNode("detectAnomalies", detectAnomalies)
    .addEdge(START, "gatherData")
    .addEdge("gatherData", "detectAnomalies")
    .addEdge("detectAnomalies", END);

  return workflow.compile();
}

export async function runInsightWorkflow(
  sql: SQL,
  days: number = 1
): Promise<AiInsight[]> {
  const app = createInsightWorkflow(sql);

  const result = await app.invoke({
    days,
    data: {
      periodComparison: null,
      teamHealth: null,
      failureClusters: null,
      teamActivity: null,
      projects: null,
    },
    insights: [],
    inputTokens: 0,
    outputTokens: 0,
  });

  await recordTokenUsage(
    sql,
    "insights",
    "gemini-2.0-flash",
    result.inputTokens,
    result.outputTokens
  );

  // Persist insights
  const expiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const persisted: AiInsight[] = [];
  for (const insight of result.insights) {
    const saved = await createInsight(sql, {
      type: insight.type,
      severity: insight.severity,
      title: insight.title,
      narrative: insight.narrative,
      data_context: { days, generated_at: new Date().toISOString() },
      source: "automated",
      expires_at: expiresAt,
    });
    persisted.push(saved);
  }

  return persisted;
}
