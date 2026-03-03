import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { callGemini, TEMPERATURE } from "../gemini";
import { getRecentSessionSequences, upsertPattern, createPatternMatch } from "../../db/patternQueries";
import { recordTokenUsage } from "../../db";
import type { SessionSequence } from "../../db/patternQueries";
import type { SessionPattern } from "@devscope/shared";

interface ClusteredPattern {
  name: string;
  description: string;
  tool_sequence: string[];
  effectiveness: string;
  category: string;
  session_ids: string[];
  avg_success_rate: number;
}

const PatternState = Annotation.Root({
  days: Annotation<number>,
  sequences: Annotation<SessionSequence[]>,
  clusteredPatterns: Annotation<ClusteredPattern[]>,
  persistedPatterns: Annotation<SessionPattern[]>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
});

type PatternStateType = typeof PatternState.State;

async function extractSequences(
  state: PatternStateType,
  sql: SQL
): Promise<Partial<PatternStateType>> {
  const sequences = await getRecentSessionSequences(sql, state.days);
  return { sequences };
}

const PATTERN_PROMPT = `You are an expert at analyzing developer tool usage patterns.

Given the following tool-call sequences from developer sessions, identify recurring patterns.
For each pattern found:
- name: A short, descriptive name (e.g., "Edit-Test Loop", "Search-Read-Edit")
- description: What this pattern represents and when developers use it
- tool_sequence: The ordered list of tool names in this pattern
- effectiveness: "effective" if avg success rate >= 0.7, "ineffective" if < 0.4, "neutral" otherwise
- category: One of "workflow", "debugging", "refactoring", "exploration", "testing"
- session_ids: Which session IDs matched this pattern
- avg_success_rate: The average success rate across matching sessions

Only report patterns that appear in 2+ sessions. Focus on meaningful sequences of 3+ tools.

Respond with ONLY valid JSON — an array of pattern objects. No markdown, no code fences.`;

async function clusterPatterns(
  state: PatternStateType
): Promise<Partial<PatternStateType>> {
  if (state.sequences.length === 0) {
    return { clusteredPatterns: [] };
  }

  const seqData = state.sequences.map((s) => ({
    session_id: s.session_id,
    tool_names: s.tool_names,
    success_rate: s.success_rate,
  }));

  const dataStr = JSON.stringify(seqData, null, 2).slice(0, 30_000);

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

  let patterns: ClusteredPattern[] = [];
  try {
    const cleaned = response.text
      .replace(/```json?\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      patterns = parsed.filter(
        (p: any) => p.name && p.tool_sequence && Array.isArray(p.tool_sequence)
      );
    }
  } catch {
    console.error(
      "[pattern-workflow] Failed to parse Gemini response:",
      response.text.slice(0, 200)
    );
  }

  return {
    clusteredPatterns: patterns,
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

async function persistPatterns(
  state: PatternStateType,
  sql: SQL
): Promise<Partial<PatternStateType>> {
  const persisted: SessionPattern[] = [];

  for (const cp of state.clusteredPatterns) {
    const pattern = await upsertPattern(sql, {
      name: cp.name,
      description: cp.description,
      tool_sequence: cp.tool_sequence,
      avg_success_rate: cp.avg_success_rate,
      occurrence_count: cp.session_ids.length,
      effectiveness: cp.effectiveness,
      category: cp.category,
    });

    for (const sessionId of cp.session_ids) {
      await createPatternMatch(sql, sessionId, pattern.id, 1.0, cp.avg_success_rate);
    }

    persisted.push(pattern);
  }

  return { persistedPatterns: persisted };
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
    clusteredPatterns: [],
    persistedPatterns: [],
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

  return result.persistedPatterns;
}
