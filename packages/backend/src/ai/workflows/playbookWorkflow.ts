import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { callGemini, TEMPERATURE } from "../gemini";
import { getPatterns } from "../../db/patternQueries";
import { createPlaybook } from "../../db/playbookQueries";
import { recordTokenUsage } from "../../db";
import type { SessionPattern, Playbook } from "@devscope/shared";

interface GeneratedPlaybook {
  name: string;
  description: string;
  tool_sequence: string[];
  when_to_use: string;
  success_metrics: Record<string, unknown>;
  source_pattern_name: string;
}

const PlaybookState = Annotation.Root({
  topPatterns: Annotation<SessionPattern[]>,
  generatedPlaybooks: Annotation<GeneratedPlaybook[]>,
  persistedPlaybooks: Annotation<Playbook[]>,
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
    limit: 10,
  });
  return { topPatterns: patterns };
}

const PLAYBOOK_PROMPT = `You are an expert at creating developer workflow playbooks.

Given these high-performing tool usage patterns, create shareable playbooks that teams can adopt.
For each playbook:
- name: A clear, actionable name (e.g., "Test-Driven Bug Fix", "Codebase Exploration")
- description: A 2-3 sentence explanation of the workflow and its benefits
- tool_sequence: The recommended ordered list of tools
- when_to_use: When a developer should use this playbook (1-2 sentences)
- success_metrics: Key metrics to track (e.g., {"target_success_rate": 0.85, "max_retries": 2})
- source_pattern_name: Which pattern this playbook is based on

Only create playbooks for patterns that are genuinely useful and teachable.
Respond with ONLY valid JSON — an array of playbook objects. No markdown, no code fences.`;

async function generatePlaybooks(
  state: PlaybookStateType
): Promise<Partial<PlaybookStateType>> {
  if (state.topPatterns.length === 0) {
    return { generatedPlaybooks: [] };
  }

  const patternData = state.topPatterns.map((p) => ({
    name: p.name,
    description: p.description,
    tool_sequence: p.tool_sequence,
    avg_success_rate: p.avg_success_rate,
    occurrence_count: p.occurrence_count,
    category: p.category,
  }));

  const dataStr = JSON.stringify(patternData, null, 2).slice(0, 25_000);

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
    const cleaned = response.text
      .replace(/```json?\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      playbooks = parsed.filter(
        (p: any) => p.name && p.tool_sequence && p.when_to_use
      );
    }
  } catch {
    console.error(
      "[playbook-workflow] Failed to parse Gemini response:",
      response.text.slice(0, 200)
    );
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
  const persisted: Playbook[] = [];

  // Find source pattern IDs by name
  const patternMap = new Map(state.topPatterns.map((p) => [p.name, p.id]));

  for (const gp of state.generatedPlaybooks) {
    const playbook = await createPlaybook(sql, {
      name: gp.name,
      description: gp.description,
      tool_sequence: gp.tool_sequence,
      when_to_use: gp.when_to_use,
      success_metrics: gp.success_metrics,
      source_pattern_id: patternMap.get(gp.source_pattern_name) ?? undefined,
      created_by: "auto",
    });
    persisted.push(playbook);
  }

  return { persistedPlaybooks: persisted };
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
    persistedPlaybooks: [],
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

  return result.persistedPlaybooks;
}
