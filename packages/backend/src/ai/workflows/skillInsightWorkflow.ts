import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { callGemini } from "../gemini";
import {
  getTeamSessionProductivity,
  getTeamSessionOutcomes,
  getTeamPatternAdoption,
  getTeamTopPatterns,
} from "../../db/patternQueries";
import {
  getTeamAntiPatterns,
  getTeamTopAntiPatterns,
} from "../../db/antiPatternQueries";
import { recordTokenUsage } from "../../db/aiQueries";

export interface SkillInsightResult {
  predictions: {
    metric: "sessions" | "completion_rate" | "effective_patterns" | "anti_patterns";
    next_weeks: { week: string; predicted_value: number; confidence: number }[];
    trend_direction: "improving" | "stable" | "declining";
    explanation: string;
  }[];

  skill_assessment: {
    dimension: string;
    score: number;
    previous_score: number;
    detail: string;
  }[];

  coaching: {
    type: "strength" | "improvement" | "action";
    title: string;
    description: string;
    impact: "high" | "medium" | "low";
    related_metric?: string;
  }[];

  growth_summary: {
    overall_trend: "improving" | "stable" | "declining";
    headline: string;
    key_insight: string;
  };
}

interface GatheredData {
  productivity: unknown;
  outcomes: unknown;
  patternAdoption: unknown;
  antiPatterns: unknown;
  topPatterns: unknown;
  topAntiPatterns: unknown;
}

const SkillInsightState = Annotation.Root({
  devIds: Annotation<string[]>,
  weeks: Annotation<number>,
  data: Annotation<GatheredData>,
  result: Annotation<SkillInsightResult | null>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
});

type SkillInsightStateType = typeof SkillInsightState.State;

async function gatherData(
  state: SkillInsightStateType,
  sql: SQL
): Promise<Partial<SkillInsightStateType>> {
  const { devIds, weeks } = state;

  const [productivity, outcomes, patternAdoption, antiPatterns, topPatterns, topAntiPatterns] =
    await Promise.all([
      getTeamSessionProductivity(sql, devIds, weeks),
      getTeamSessionOutcomes(sql, devIds, weeks),
      getTeamPatternAdoption(sql, devIds, weeks),
      getTeamAntiPatterns(sql, devIds, weeks),
      getTeamTopPatterns(sql, devIds, weeks, 10),
      getTeamTopAntiPatterns(sql, devIds, weeks, 10),
    ]);

  return {
    data: { productivity, outcomes, patternAdoption, antiPatterns, topPatterns, topAntiPatterns },
  };
}

const SKILL_INSIGHT_PROMPT = `You are a Claude Code usage analyst helping a development team improve how they use Claude Code (an AI coding assistant).
Analyze the team's session data, usage patterns, and outcomes to assess their Claude Code proficiency and provide actionable improvement tips.

You MUST respond with ONLY valid JSON matching this exact structure (no markdown, no code fences):

{
  "predictions": [
    {
      "metric": "sessions" | "completion_rate" | "effective_patterns" | "anti_patterns",
      "next_weeks": [{ "week": "YYYY-MM-DD", "predicted_value": number, "confidence": 0-1 }],
      "trend_direction": "improving" | "stable" | "declining",
      "explanation": "string"
    }
  ],
  "skill_assessment": [
    {
      "dimension": "string",
      "score": 0-100,
      "previous_score": 0-100,
      "detail": "one sentence"
    }
  ],
  "coaching": [
    {
      "type": "strength" | "improvement" | "action",
      "title": "short title",
      "description": "actionable description",
      "impact": "high" | "medium" | "low",
      "related_metric": "optional metric name"
    }
  ],
  "growth_summary": {
    "overall_trend": "improving" | "stable" | "declining",
    "headline": "short headline e.g. Team Claude Code proficiency improving steadily",
    "key_insight": "1-2 sentence analysis"
  }
}

Skill assessment dimensions MUST focus on how the team uses Claude Code:
- "Prompt Clarity": How well developers structure their prompts (specificity, context, file references). High score = focused prompts with good context, low score = vague or overly broad requests.
- "Task Decomposition": How well developers break complex work into manageable Claude Code sessions. High score = focused sessions with clear goals, low score = sprawling sessions that struggle.
- "Feature Utilization": How effectively the team uses Claude Code's features (agents for research, continuation for follow-ups, slash commands). High score = leveraging advanced features, low score = basic usage only.
- "Error Recovery": How well developers adapt when Claude Code encounters issues (rephrasing, providing context, changing approach). High score = quick pivots, low score = repeated failures.
- "Session Effectiveness": Overall success rate and completion rate of Claude Code sessions. High score = consistent completion, low score = many abandoned or failed sessions.

Coaching items MUST be about improving Claude Code usage, not about coaching Claude Code itself:
- GOOD coaching: "Try including file paths in prompts for faster navigation", "Use agents for complex codebase exploration", "Break large refactoring into focused sessions"
- BAD coaching: "Claude should use Read before Edit", "Reduce Bash tool retry loops"
- Reference specific Claude Code best practices: CLAUDE.md files, /clear command, Agent tool, continuation prompts, specific file references, permission modes

Rules:
- Generate 2-4 predictions (one per metric if data exists)
- Generate exactly 5 skill assessment dimensions (the ones listed above)
- Generate 3-6 coaching items (mix of strengths, improvements, and actions)
- ALL coaching must be developer-facing advice about Claude Code usage
- For predictions, project 3 weeks ahead with decreasing confidence
- Base scores and predictions on actual data trends, not guesses
- If data is sparse, say so in explanations and use wider confidence intervals
- Focus on team-level patterns — never reference individual developers`;

async function analyzeGrowth(
  state: SkillInsightStateType
): Promise<Partial<SkillInsightStateType>> {
  const dataStr = JSON.stringify(state.data, null, 2).slice(0, 30_000);

  const response = await callGemini(
    [
      {
        role: "user",
        parts: [{ text: SKILL_INSIGHT_PROMPT + "\n\nTeam Data:\n" + dataStr }],
      },
    ],
    undefined,
    { temperature: 0.4 }
  );

  let result: SkillInsightResult | null = null;
  try {
    const cleaned = response.text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.predictions && parsed.skill_assessment && parsed.coaching && parsed.growth_summary) {
      result = parsed as SkillInsightResult;
    }
  } catch {
    console.error("[skill-insights] Failed to parse Gemini response:", response.text.slice(0, 200));
  }

  return {
    result,
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

export function createSkillInsightWorkflow(sql: SQL) {
  const workflow = new StateGraph(SkillInsightState)
    .addNode("gatherData", (state) => gatherData(state, sql))
    .addNode("analyzeGrowth", analyzeGrowth)
    .addEdge(START, "gatherData")
    .addEdge("gatherData", "analyzeGrowth")
    .addEdge("analyzeGrowth", END);

  return workflow.compile();
}

export async function runSkillInsightWorkflow(
  sql: SQL,
  devIds: string[],
  weeks: number = 12
): Promise<SkillInsightResult | null> {
  const app = createSkillInsightWorkflow(sql);

  const result = await app.invoke({
    devIds,
    weeks,
    data: {
      productivity: null,
      outcomes: null,
      patternAdoption: null,
      antiPatterns: null,
      topPatterns: null,
      topAntiPatterns: null,
    },
    result: null,
    inputTokens: 0,
    outputTokens: 0,
  });

  await recordTokenUsage(
    sql,
    "team-skills",
    "gemini-2.0-flash",
    result.inputTokens,
    result.outputTokens
  );

  return result.result;
}
