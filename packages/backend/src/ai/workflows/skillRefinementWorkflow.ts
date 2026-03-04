import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { callGemini, TEMPERATURE } from "../gemini";
import { getPatterns } from "../../db/patternQueries";
import { getAntiPatterns } from "../../db/antiPatternQueries";
import { getRecentSessionSequences, type SessionSequence } from "../../db/patternQueries";
import {
  getTeamSkillById,
  createTeamSkill,
  updateTeamSkill,
  linkSkillToPattern,
  getSkillPatternLinks,
} from "../../db/teamSkillQueries";
import { recordTokenUsage } from "../../db/aiQueries";
import type { SessionPattern, AntiPattern, TeamSkill, TeamSkillPatternLink } from "@devscope/shared";

type RefinementDecision = "no_change" | "update" | "archive";

interface RefinementResult {
  decision: RefinementDecision;
  updated_name?: string;
  updated_description?: string;
  updated_trigger_phrases?: string[];
  updated_skill_body?: string;
  reason: string;
}

const RefinementState = Annotation.Root({
  skillId: Annotation<string>,
  orgId: Annotation<string>,
  existingSkill: Annotation<TeamSkill | null>,
  existingLinks: Annotation<TeamSkillPatternLink[]>,
  freshPatterns: Annotation<SessionPattern[]>,
  freshAntiPatterns: Annotation<AntiPattern[]>,
  sessionSequences: Annotation<SessionSequence[]>,
  refinementResult: Annotation<RefinementResult | null>,
  resultSkill: Annotation<TeamSkill | null>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
});

type RefinementStateType = typeof RefinementState.State;

// --- Node 1: Gather new data ---

async function gatherNewData(
  state: RefinementStateType,
  sql: SQL
): Promise<Partial<RefinementStateType>> {
  const [existingSkill, freshPatterns, freshAntiPatterns, sessionSequences] =
    await Promise.all([
      getTeamSkillById(sql, state.skillId),
      getPatterns(sql, { effectiveness: "effective", minOccurrences: 2, limit: 15 }),
      getAntiPatterns(sql, { limit: 10 }),
      getRecentSessionSequences(sql, 14, 50),
    ]);

  const existingLinks = existingSkill
    ? await getSkillPatternLinks(sql, existingSkill.id)
    : [];

  return { existingSkill, existingLinks, freshPatterns, freshAntiPatterns, sessionSequences };
}

// --- Node 2: Refine via Gemini ---

const REFINEMENT_PROMPT = `You are refining an existing Claude Code plugin skill based on new session data.
Skills encode proven developer workflow strategies as reusable Claude Code workflows.

Current skill:
{current_skill}

New data since this skill was created:
{new_data}

Decide one of:
- "no_change": the skill is still accurate and effective
- "update": the skill should be updated with new insights (provide full updated fields)
- "archive": the skill is no longer relevant or useful

If "update", provide ALL updated fields (even if unchanged):
- updated_name: skill name (should describe the developer strategy, not internal tool sequences)
- updated_description: skill description (explain when a developer would use this)
- updated_trigger_phrases: trigger phrases array
- updated_skill_body: full SKILL.md body (encode the developer's proven workflow strategy)

Rules:
- Only update if there's meaningful new information from the data
- Preserve the skill's core purpose when updating
- Ensure descriptions focus on the developer's strategy, not Claude Code's internal tool behavior
- Focus on team-level workflows — never reference individuals
- Respond with ONLY valid JSON — no markdown, no code fences

Return format:
{
  "decision": "no_change" | "update" | "archive",
  "updated_name": "string (if update)",
  "updated_description": "string (if update)",
  "updated_trigger_phrases": ["string"] (if update),
  "updated_skill_body": "string (if update)",
  "reason": "1 sentence explaining the decision"
}`;

async function refineSkill(
  state: RefinementStateType
): Promise<Partial<RefinementStateType>> {
  if (!state.existingSkill) {
    return { refinementResult: { decision: "no_change", reason: "Skill not found" } };
  }

  const currentSkill = {
    name: state.existingSkill.name,
    description: state.existingSkill.description,
    trigger_phrases: state.existingSkill.trigger_phrases,
    skill_body: state.existingSkill.skill_body,
    generation_context: state.existingSkill.generation_context,
    version: state.existingSkill.version,
  };

  const newData = {
    patterns: state.freshPatterns.slice(0, 10).map(p => ({
      name: p.name,
      description: p.description,
      tool_sequence: p.tool_sequence,
      avg_success_rate: p.avg_success_rate,
      occurrence_count: p.occurrence_count,
    })),
    anti_patterns: state.freshAntiPatterns.slice(0, 5).map(ap => ({
      name: ap.name,
      description: ap.description,
      suggestion: ap.suggestion,
    })),
    session_samples: state.sessionSequences.slice(0, 15).map(s => ({
      tool_names: s.tool_names.slice(0, 20),
      success_rate: s.success_rate,
      prompt_count: s.prompt_count,
      avg_prompt_length: s.avg_prompt_length,
      continuation_ratio: s.continuation_ratio,
      agent_delegations: s.agent_delegations,
      ...(s.prompt_features ? { prompt_features: s.prompt_features } : {}),
    })),
  };

  const prompt = REFINEMENT_PROMPT
    .replace("{current_skill}", JSON.stringify(currentSkill, null, 2))
    .replace("{new_data}", JSON.stringify(newData, null, 2).slice(0, 15_000));

  const response = await callGemini(
    [{ role: "user", parts: [{ text: prompt }] }],
    undefined,
    { temperature: TEMPERATURE.report }
  );

  let result: RefinementResult | null = null;
  try {
    const cleaned = response.text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.decision && parsed.reason) {
      result = parsed as RefinementResult;
    }
  } catch {
    console.error("[skill-refine] Failed to parse Gemini response:", response.text.slice(0, 200));
  }

  return {
    refinementResult: result,
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

// --- Node 3: Persist refinement ---

async function persistRefinement(
  state: RefinementStateType,
  sql: SQL
): Promise<Partial<RefinementStateType>> {
  if (!state.existingSkill || !state.refinementResult) {
    return { resultSkill: null };
  }

  const { decision } = state.refinementResult;

  if (decision === "no_change") {
    return { resultSkill: state.existingSkill };
  }

  if (decision === "archive") {
    await updateTeamSkill(sql, state.existingSkill.id, { status: "archived" });
    const archived = await getTeamSkillById(sql, state.existingSkill.id);
    return { resultSkill: archived };
  }

  if (decision === "update") {
    const r = state.refinementResult;

    // Archive old version
    await updateTeamSkill(sql, state.existingSkill.id, { status: "archived" });

    // Create new version
    const newSkill = await createTeamSkill(sql, {
      organization_id: state.orgId,
      name: r.updated_name ?? state.existingSkill.name,
      description: r.updated_description ?? state.existingSkill.description,
      trigger_phrases: r.updated_trigger_phrases ?? state.existingSkill.trigger_phrases,
      skill_body: r.updated_skill_body ?? state.existingSkill.skill_body,
      source_pattern_ids: state.existingSkill.source_pattern_ids,
      source_anti_pattern_ids: state.existingSkill.source_anti_pattern_ids,
      version: state.existingSkill.version + 1,
      previous_version_id: state.existingSkill.id,
      generation_context: {
        ...state.existingSkill.generation_context,
        refinement_reason: r.reason,
        refined_at: new Date().toISOString(),
      },
      status: "draft",
      created_by: "auto",
    });

    // Copy pattern links to new version
    for (const link of state.existingLinks) {
      await linkSkillToPattern(sql, {
        skill_id: newSkill.id,
        pattern_id: link.pattern_id ?? undefined,
        anti_pattern_id: link.anti_pattern_id ?? undefined,
        link_type: link.link_type,
      });
    }

    return { resultSkill: newSkill };
  }

  return { resultSkill: null };
}

// --- Workflow assembly ---

export function createSkillRefinementWorkflow(sql: SQL) {
  const workflow = new StateGraph(RefinementState)
    .addNode("gatherNewData", (state) => gatherNewData(state, sql))
    .addNode("refineSkill", refineSkill)
    .addNode("persistRefinement", (state) => persistRefinement(state, sql))
    .addEdge(START, "gatherNewData")
    .addEdge("gatherNewData", "refineSkill")
    .addEdge("refineSkill", "persistRefinement")
    .addEdge("persistRefinement", END);

  return workflow.compile();
}

export async function runSkillRefinementWorkflow(
  sql: SQL,
  skillId: string,
  orgId: string
): Promise<TeamSkill | null> {
  const app = createSkillRefinementWorkflow(sql);

  const result = await app.invoke({
    skillId,
    orgId,
    existingSkill: null,
    existingLinks: [],
    freshPatterns: [],
    freshAntiPatterns: [],
    sessionSequences: [],
    refinementResult: null,
    resultSkill: null,
    inputTokens: 0,
    outputTokens: 0,
  });

  await recordTokenUsage(
    sql,
    "team-skill-refine",
    "gemini-2.0-flash",
    result.inputTokens,
    result.outputTokens
  );

  return result.resultSkill;
}
