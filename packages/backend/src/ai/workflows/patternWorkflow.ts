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

const PATTERN_PROMPT = `You are analyzing how developers USE Claude Code to identify recurring developer strategies and habits.

Each session includes: tool call sequences (what Claude Code did), prompt metadata (how the developer communicated), and agent delegation info (whether the developer used sub-agents).

Your goal is to identify the DEVELOPER'S approach — how they prompt, structure tasks, and direct Claude Code — not just what tools Claude Code used internally.

For each pattern found, provide:
- name: a developer-action-oriented name that describes what the DEVELOPER does (e.g. "Explore Before Editing", "Incremental Test-Fix Cycles", "Agent-Assisted Research", "Focused Single-Task Sessions", "Iterative Prompt Refinement")
  - BAD names (tool-centric): "Glob-Read Exploration", "Bash-heavy execution", "Read-Edit Loop"
  - GOOD names (developer-centric): "Research-First Approach", "Direct Execution Style", "Careful Refactoring"
- description: 1-2 sentences explaining the developer's strategy and WHY it works well (or poorly). Frame it as what the developer does, not what Claude does.
  - BAD: "The developer uses Glob to find files and then reads them"
  - GOOD: "The developer asks Claude to explore the codebase before making changes, leading to better-informed edits with fewer mistakes"
- tool_sequence: canonical ordered tool names (e.g. ["Read", "Edit", "Bash"])
- effectiveness: "effective" if sessions using it have high success rates (>0.7), "ineffective" if low (<0.4), "neutral" otherwise
- category: one of "testing", "refactoring", "debugging", "exploration", "writing", "other"
- session_ids: array of session IDs that exhibited this pattern
- avg_success_rate: average tool success rate across matching sessions

Key signals to consider:
- prompt_count & avg_prompt_length: How the developer structures their requests (few long prompts = detailed specs, many short = iterative guidance)
- continuation_ratio: High = developer uses follow-ups effectively; Low = developer gives complete instructions upfront
- agent_delegations & agent_types: Whether the developer leverages sub-agents for parallel research
- tool sequence patterns: What workflows the developer's prompts lead to
- success_rate: How well the developer's approach works
- prompt_features (when available): Locally-extracted characteristics of how developers write their prompts:
  - file_references: Number of prompts mentioning specific file paths (high = developer gives precise locations)
  - code_references: Number of prompts mentioning function/class names (high = developer provides code context)
  - questions vs directives: Whether the developer asks questions or gives commands
  - includes_errors: Whether the developer includes error messages in their prompts
  - avg_specificity: 0-1 score of how specific/detailed the prompts are
  - slash_commands: Whether the developer uses Claude Code slash commands (/commit, /clear, etc.)

IMPORTANT: Focus on team-level patterns only. Do not reference individual developers by name, rank, or performance comparisons. All pattern descriptions must be anonymous and team-oriented.

Focus on patterns that appear in 2+ sessions. Merge similar patterns.
Return a JSON array. Return an empty array if no meaningful patterns found.
Respond with ONLY valid JSON — no markdown, no code fences, no other text.`;

async function clusterPatterns(
  state: PatternStateType
): Promise<Partial<PatternStateType>> {
  if (state.sequences.length === 0) {
    return { discoveredPatterns: [] };
  }

  // Prepare session data for the LLM — include developer behavior signals
  // NOTE: prompt_features are extracted locally from prompt text — raw text is never sent
  const sessionData = state.sequences.map(s => ({
    session_id: s.session_id,
    tool_names: s.tool_names.slice(0, 50), // Cap at 50 tools per session
    success_rate: s.success_rate,
    prompt_count: s.prompt_count,
    avg_prompt_length: s.avg_prompt_length,
    continuation_ratio: s.continuation_ratio,
    agent_delegations: s.agent_delegations,
    agent_types: s.agent_types,
    duration_minutes: s.duration_minutes,
    ...(s.prompt_features ? { prompt_features: s.prompt_features } : {}),
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
