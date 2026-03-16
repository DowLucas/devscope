import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { callGemini, TEMPERATURE } from "../gemini";
import {
  gatherMaturityMetrics,
  upsertMaturitySnapshot,
  recordTokenUsage,
} from "../../db";
import type { AiMaturitySnapshot, MaturityDimensions } from "@devscope/shared";

const MaturityState = Annotation.Root({
  orgId: Annotation<string>,
  developerIds: Annotation<string[]>,
  metrics: Annotation<Record<string, unknown>>,
  dimensions: Annotation<MaturityDimensions>,
  overallScore: Annotation<number>,
  narrative: Annotation<string>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
});

type MaturityStateType = typeof MaturityState.State;

async function gatherMetrics(
  state: MaturityStateType,
  sql: SQL
): Promise<Partial<MaturityStateType>> {
  const metrics = await gatherMaturityMetrics(sql, state.orgId, state.developerIds);
  return { metrics };
}

function computeDimensions(
  state: MaturityStateType
): Partial<MaturityStateType> {
  const m = state.metrics as any;

  // Tool Adoption Breadth: score based on unique tools used (max 100 for 15+ tools)
  const toolAdoption = Math.min(100, (m.unique_tools ?? 0) * (100 / 15));

  // Workflow Efficiency: ratio of pattern matches vs anti-patterns
  const totalMatches = (m.pattern_matches ?? 0) + (m.anti_pattern_matches ?? 0);
  const workflowEfficiency = totalMatches > 0
    ? ((m.pattern_matches ?? 0) / totalMatches) * 100
    : 50; // Neutral if no data

  // Failure Recovery: success rate
  const totalToolCalls = (m.success_count ?? 0) + (m.fail_count ?? 0);
  const failureRecovery = totalToolCalls > 0
    ? ((m.success_count ?? 0) / totalToolCalls) * 100
    : 50;

  // Skill Adoption: based on active skills and adoption count
  const skillScore = Math.min(100,
    ((m.active_skills ?? 0) * 15) + ((m.total_skill_adoption ?? 0) * 5));

  // AI Collaboration: agent delegation rate per session
  const sessions = m.total_sessions ?? 0;
  const agentRate = sessions > 0 ? ((m.agent_starts ?? 0) / sessions) * 100 : 0;
  const aiCollaboration = Math.min(100, agentRate * 2); // 50% delegation = 100 score

  const dimensions: MaturityDimensions = {
    tool_adoption: Math.round(toolAdoption * 100) / 100,
    workflow_efficiency: Math.round(workflowEfficiency * 100) / 100,
    failure_recovery: Math.round(failureRecovery * 100) / 100,
    skill_adoption: Math.round(skillScore * 100) / 100,
    ai_collaboration: Math.round(aiCollaboration * 100) / 100,
  };

  const overallScore = Math.round(
    (dimensions.tool_adoption +
      dimensions.workflow_efficiency +
      dimensions.failure_recovery +
      dimensions.skill_adoption +
      dimensions.ai_collaboration) / 5 * 100
  ) / 100;

  return { dimensions, overallScore };
}

async function generateNarrative(
  state: MaturityStateType
): Promise<Partial<MaturityStateType>> {
  const dataStr = JSON.stringify({
    dimensions: state.dimensions,
    overallScore: state.overallScore,
    rawMetrics: state.metrics,
  }, null, 2);

  const response = await callGemini(
    [
      {
        role: "user",
        parts: [
          {
            text: `You are an AI tooling maturity analyst. Generate a brief narrative (2-4 sentences) summarizing this team's AI tooling maturity index.

Dimensions (0-100 scale):
${dataStr}

IMPORTANT: Focus on team-level patterns only. Do NOT mention individual developers.
Highlight the strongest and weakest dimensions. Suggest one concrete improvement.
Keep the tone encouraging and actionable.`,
          },
        ],
      },
    ],
    undefined,
    { temperature: TEMPERATURE.insight }
  );

  return {
    narrative: response.text,
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

export function createMaturityWorkflow(sql: SQL) {
  const workflow = new StateGraph(MaturityState)
    .addNode("gatherMetrics", (state) => gatherMetrics(state, sql))
    .addNode("computeDimensions", computeDimensions)
    .addNode("generateNarrative", generateNarrative)
    .addEdge(START, "gatherMetrics")
    .addEdge("gatherMetrics", "computeDimensions")
    .addEdge("computeDimensions", "generateNarrative")
    .addEdge("generateNarrative", END);

  return workflow.compile();
}

export async function runMaturityWorkflow(
  sql: SQL,
  orgId: string,
  developerIds: string[]
): Promise<AiMaturitySnapshot> {
  const app = createMaturityWorkflow(sql);

  const result = await app.invoke({
    orgId,
    developerIds,
    metrics: {},
    dimensions: {
      tool_adoption: 0,
      workflow_efficiency: 0,
      failure_recovery: 0,
      skill_adoption: 0,
      ai_collaboration: 0,
    },
    overallScore: 0,
    narrative: "",
    inputTokens: 0,
    outputTokens: 0,
  });

  await recordTokenUsage(
    sql,
    "maturity",
    "gemini-2.0-flash",
    result.inputTokens,
    result.outputTokens
  );

  const today = new Date().toISOString().split("T")[0];
  return upsertMaturitySnapshot(
    sql,
    orgId,
    today,
    result.overallScore,
    result.dimensions,
    result.narrative,
    { raw_metrics: result.metrics }
  );
}
