import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { callGemini, TEMPERATURE } from "../gemini";
import {
  getRecentSessionSequences,
  upsertPattern,
  createPatternMatch,
  type SessionSequence,
} from "../../db/patternQueries";
import { recordTokenUsage } from "../../db";
import type { SessionPattern } from "@devscope/shared";

interface DiscoveredPattern {
  name: string;
  description: string;
  tool_sequence: string[];
  effectiveness: "effective" | "neutral" | "ineffective";
  category: string;
  session_ids: string[];
  avg_success_rate: number;
}

const PatternState = Annotation.Root({
  days: Annotation<number>,
  sequences: Annotation<SessionSequence[]>,
  discoveredPatterns: Annotation<DiscoveredPattern[]>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
});

type PatternStateType = typeof PatternState.State;

async function extractSequences(
  state: PatternStateType,
  sql: SQL
): Promise<Partial<PatternStateType>> {
  const sequences = await getRecentSessionSequences(sql, state.days, 200);
  return { sequences };
}

const PATTERN_PROMPT = `You are analyzing Claude Code developer sessions to discover workflow patterns.
Each session below contains a sequence of tool calls with success/failure outcomes.

Identify recurring patterns — named workflow strategies that developers use.
For each pattern found:
- name: short descriptive name (e.g. "Read-before-Edit", "Test-driven loop", "Grep-then-Read exploration")
- description: 1-2 sentences explaining the workflow strategy
- tool_sequence: canonical ordered tool names (e.g. ["Read", "Edit", "Bash"])
- effectiveness: "effective" if sessions using it have high success rates (>0.7), "ineffective" if low (<0.4), "neutral" otherwise
- category: one of "testing", "refactoring", "debugging", "exploration", "writing", "other"
- session_ids: array of session IDs that exhibited this pattern
- avg_success_rate: average tool success rate across matching sessions

Focus on patterns that appear in 2+ sessions. Merge similar patterns.
Return a JSON array. Return an empty array if no meaningful patterns found.
Respond with ONLY valid JSON — no markdown, no code fences, no other text.`;

async function clusterPatterns(
  state: PatternStateType
): Promise<Partial<PatternStateType>> {
  if (state.sequences.length === 0) {
    return { discoveredPatterns: [] };
  }

  // Prepare session data for the LLM — truncate to fit context
  const sessionData = state.sequences.map(s => ({
    session_id: s.session_id,
    tool_names: s.tool_names.slice(0, 50), // Cap at 50 tools per session
    success_rate: s.success_rate,
  }));

  const dataStr = JSON.stringify(sessionData, null, 2).slice(0, 25_000);

  const response = await callGemini(
    [
      {
        role: "user",
        parts: [{ text: PATTERN_PROMPT + "\n\nSessions:\n" + dataStr }],
      },
    ],
    undefined,
    { temperature: TEMPERATURE.insight }
  );

  let patterns: DiscoveredPattern[] = [];
  try {
    const cleaned = response.text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      patterns = parsed.filter(
        (p: any) => p.name && p.tool_sequence && Array.isArray(p.tool_sequence)
      );
    }
  } catch {
    console.error("[pattern-analysis] Failed to parse Gemini response:", response.text.slice(0, 200));
  }

  return {
    discoveredPatterns: patterns,
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

async function persistPatterns(
  state: PatternStateType,
  sql: SQL
): Promise<Partial<PatternStateType>> {
  for (const pattern of state.discoveredPatterns) {
    const persisted = await upsertPattern(sql, {
      name: pattern.name,
      description: pattern.description,
      tool_sequence: pattern.tool_sequence,
      avg_success_rate: pattern.avg_success_rate ?? 0,
      occurrence_count: pattern.session_ids?.length ?? 1,
      effectiveness: pattern.effectiveness ?? "neutral",
      category: pattern.category,
    });

    // Link sessions to this pattern
    if (pattern.session_ids) {
      for (const sessionId of pattern.session_ids) {
        const seq = state.sequences.find(s => s.session_id === sessionId);
        try {
          await createPatternMatch(
            sql,
            sessionId,
            persisted.id,
            1.0,
            seq?.success_rate
          );
        } catch {
          // Ignore duplicate or FK constraint violations
        }
      }
    }
  }

  return {};
}

export function createPatternWorkflow(sql: SQL) {
  const workflow = new StateGraph(PatternState)
    .addNode("extractSequences", (state) => extractSequences(state, sql))
    .addNode("clusterPatterns", clusterPatterns)
    .addNode("persistPatterns", (state) => persistPatterns(state, sql))
    .addEdge(START, "extractSequences")
    .addEdge("extractSequences", "clusterPatterns")
    .addEdge("clusterPatterns", "persistPatterns")
    .addEdge("persistPatterns", END);

  return workflow.compile();
}

export async function runPatternWorkflow(
  sql: SQL,
  days: number = 1
): Promise<SessionPattern[]> {
  const app = createPatternWorkflow(sql);

  const result = await app.invoke({
    days,
    sequences: [],
    discoveredPatterns: [],
    inputTokens: 0,
    outputTokens: 0,
  });

  await recordTokenUsage(
    sql,
    "patterns",
    "gemini-2.0-flash",
    result.inputTokens,
    result.outputTokens
  );

  // Return all recently updated patterns
  const { getPatterns } = await import("../../db/patternQueries");
  return getPatterns(sql, { limit: 20 });
}
