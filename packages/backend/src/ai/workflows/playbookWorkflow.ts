import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { callGemini, TEMPERATURE } from "../gemini";
import { getPatterns } from "../../db/patternQueries";
import { createPlaybook } from "../../db/playbookQueries";
import { recordTokenUsage } from "../../db";
import type { SessionPattern, Playbook } from "@devscope/shared";

interface GeneratedPlaybook {
  source_pattern_name: string;
  name: string;
  description: string;
  tool_sequence: string[];
  when_to_use: string;
  success_metrics: Record<string, unknown>;
}

const PlaybookState = Annotation.Root({
  topPatterns: Annotation<SessionPattern[]>,
  generatedPlaybooks: Annotation<GeneratedPlaybook[]>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
});

type PlaybookStateType = typeof PlaybookState.State;

async function gatherTopPatterns(
  state: PlaybookStateType,
  sql: SQL
): Promise<Partial<PlaybookStateType>> {
  const patterns = await getPatterns(sql, {
    effectiveness: "effective",
    minOccurrences: 3,
    limit: 15,
  });

  return { topPatterns: patterns };
}

const PLAYBOOK_PROMPT = `You are creating Claude Code usage guides for developers based on proven effective strategies.
Each pattern below was discovered from real Claude Code sessions and represents a developer approach that consistently leads to good outcomes.

Your playbooks should teach DEVELOPERS how to use Claude Code more effectively — they are guides for humans, not instructions for Claude.

For each pattern that would make a good reusable playbook, generate:
- source_pattern_name: the original pattern name (for linking)
- name: developer-action-oriented playbook name that describes what the DEVELOPER does (e.g. "Research Before Refactoring", "Test-Driven Development with Claude", "Focused Debug Sessions")
  - BAD names: "Read-Edit Loop", "Bash-then-Read" (these describe tool sequences)
  - GOOD names: "Explore First, Then Edit", "Incremental Testing Workflow" (these describe developer strategies)
- description: 2-3 sentences explaining the developer strategy, WHY it works, and how it helps get better results from Claude Code
- tool_sequence: the canonical tool sequence (from the pattern)
- when_to_use: 1-2 sentences describing when a developer should use this approach with Claude Code
- success_metrics: { avg_success_rate: number, typical_sessions: number }

IMPORTANT: Do not include individual developer names, rankings, or performance comparisons in any playbook. All guidance must be team-level and behavior-focused.

Only create playbooks for strategies that are clearly useful, replicable, and would help developers improve their Claude Code usage.
Skip patterns that are too generic or context-specific.
Return a JSON array. Return empty array if no good playbooks can be made.
Respond with ONLY valid JSON — no markdown, no code fences.`;

async function generatePlaybooks(
  state: PlaybookStateType
): Promise<Partial<PlaybookStateType>> {
  if (state.topPatterns.length === 0) {
    return { generatedPlaybooks: [] };
  }

  const patternData = state.topPatterns.map(p => ({
    name: p.name,
    description: p.description,
    tool_sequence: p.tool_sequence,
    avg_success_rate: p.avg_success_rate,
    occurrence_count: p.occurrence_count,
    category: p.category,
  }));

  const dataStr = JSON.stringify(patternData, null, 2);

  const response = await callGemini(
    [
      {
        role: "user",
        parts: [{ text: PLAYBOOK_PROMPT + "\n\nPatterns:\n" + dataStr }],
      },
    ],
    undefined,
    { temperature: TEMPERATURE.report }
  );

  let playbooks: GeneratedPlaybook[] = [];
  try {
    const cleaned = response.text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      playbooks = parsed.filter(
        (p: any) => p.name && p.description && p.tool_sequence
      );
    }
  } catch {
    console.error("[playbooks] Failed to parse Gemini response:", response.text.slice(0, 200));
  }

  return {
    generatedPlaybooks: playbooks,
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

async function persistPlaybooks(
  state: PlaybookStateType,
  sql: SQL
): Promise<Partial<PlaybookStateType>> {
  for (const pb of state.generatedPlaybooks) {
    // Find the source pattern ID
    const sourcePattern = state.topPatterns.find(
      p => p.name === pb.source_pattern_name
    );

    try {
      await createPlaybook(sql, {
        name: pb.name,
        description: pb.description,
        tool_sequence: pb.tool_sequence,
        when_to_use: pb.when_to_use,
        success_metrics: pb.success_metrics ?? {},
        source_pattern_id: sourcePattern?.id,
        created_by: "auto",
      });
    } catch {
      // Ignore duplicates
    }
  }

  return {};
}

export function createPlaybookWorkflow(sql: SQL) {
  const workflow = new StateGraph(PlaybookState)
    .addNode("gatherTopPatterns", (state) => gatherTopPatterns(state, sql))
    .addNode("generatePlaybooks", generatePlaybooks)
    .addNode("persistPlaybooks", (state) => persistPlaybooks(state, sql))
    .addEdge(START, "gatherTopPatterns")
    .addEdge("gatherTopPatterns", "generatePlaybooks")
    .addEdge("generatePlaybooks", "persistPlaybooks")
    .addEdge("persistPlaybooks", END);

  return workflow.compile();
}

export async function runPlaybookWorkflow(sql: SQL): Promise<Playbook[]> {
  const app = createPlaybookWorkflow(sql);

  const result = await app.invoke({
    topPatterns: [],
    generatedPlaybooks: [],
    inputTokens: 0,
    outputTokens: 0,
  });

  await recordTokenUsage(
    sql,
    "playbooks",
    "gemini-2.0-flash",
    result.inputTokens,
    result.outputTokens
  );

  const { getPlaybooks } = await import("../../db/playbookQueries");
  return getPlaybooks(sql);
}
