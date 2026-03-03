import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { callGemini, TEMPERATURE } from "../gemini";
import { getPatterns } from "../../db/patternQueries";
import { getAntiPatterns } from "../../db/antiPatternQueries";
import { getRecentSessionSequences, type SessionSequence } from "../../db/patternQueries";
import {
  createTeamSkill,
  linkSkillToPattern,
  getActiveSkillNames,
} from "../../db/teamSkillQueries";
import { recordTokenUsage } from "../../db/aiQueries";
import type { SessionPattern, AntiPattern, TeamSkill } from "@devscope/shared";

interface GeneratedSkill {
  name: string;
  description: string;
  trigger_phrases: string[];
  skill_body: string;
  source_pattern_names: string[];
  source_anti_pattern_names: string[];
  rationale: string;
}

const SkillGenState = Annotation.Root({
  orgId: Annotation<string>,
  effectivePatterns: Annotation<SessionPattern[]>,
  antiPatterns: Annotation<AntiPattern[]>,
  sessionSequences: Annotation<SessionSequence[]>,
  existingSkillNames: Annotation<string[]>,
  generatedSkills: Annotation<GeneratedSkill[]>,
  persistedSkills: Annotation<TeamSkill[]>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
});

type SkillGenStateType = typeof SkillGenState.State;

// --- Node 1: Gather data ---

async function gatherData(
  state: SkillGenStateType,
  sql: SQL
): Promise<Partial<SkillGenStateType>> {
  const [effectivePatterns, antiPatterns, sessionSequences, existingSkillNames] =
    await Promise.all([
      getPatterns(sql, { effectiveness: "effective", minOccurrences: 3, limit: 15 }),
      getAntiPatterns(sql, { limit: 10 }),
      getRecentSessionSequences(sql, 14, 100),
      getActiveSkillNames(sql, state.orgId),
    ]);

  return { effectivePatterns, antiPatterns, sessionSequences, existingSkillNames };
}

// --- Node 2: Generate skills via Gemini ---

const SKILL_GEN_PROMPT = `You are generating reusable Claude Code plugin skills (SKILL.md format) from team session data.

A SKILL.md file has:
- A YAML frontmatter with: name (kebab-case), description (when to use this skill)
- A list of trigger_phrases (short phrases that should activate this skill)
- A markdown body with imperative instructions for Claude Code to follow

For each skill you generate, provide:
- name: human-readable skill name (e.g. "Safe Database Migration", "TDD Red-Green-Refactor")
- description: 1-2 sentences explaining when to use this skill
- trigger_phrases: 3-5 short trigger phrases (e.g. "migrate database", "run migration", "schema change")
- skill_body: the full SKILL.md body in markdown — imperative, step-by-step instructions that Claude Code can follow. Reference specific tool sequences and patterns discovered from the data. Include guardrails from anti-pattern solutions.
- source_pattern_names: which patterns this skill is derived from
- source_anti_pattern_names: which anti-patterns this skill helps prevent
- rationale: 1 sentence explaining why this skill is valuable for the team

Rules:
- Generate 2-5 skills maximum
- Each skill must be derived from actual patterns in the data — don't invent generic skills
- Skill bodies should be actionable and specific, not vague advice
- Include anti-pattern prevention steps where relevant
- Focus on team-level workflows — never reference individual developers
- Avoid duplicating these existing skills: {existing_skills}
- Return a JSON array. Return empty array if no good skills can be generated.
- Respond with ONLY valid JSON — no markdown, no code fences.`;

async function generateSkills(
  state: SkillGenStateType
): Promise<Partial<SkillGenStateType>> {
  if (state.effectivePatterns.length === 0) {
    return { generatedSkills: [] };
  }

  const patternData = state.effectivePatterns.map(p => ({
    name: p.name,
    description: p.description,
    tool_sequence: p.tool_sequence,
    avg_success_rate: p.avg_success_rate,
    occurrence_count: p.occurrence_count,
    category: p.category,
  }));

  const antiPatternData = state.antiPatterns.map(ap => ({
    name: ap.name,
    description: ap.description,
    suggestion: ap.suggestion,
    severity: ap.severity,
    occurrence_count: ap.occurrence_count,
  }));

  const sessionSample = state.sessionSequences.slice(0, 30).map(s => ({
    tool_names: s.tool_names.slice(0, 30),
    success_rate: s.success_rate,
  }));

  const prompt = SKILL_GEN_PROMPT.replace(
    "{existing_skills}",
    state.existingSkillNames.length > 0 ? state.existingSkillNames.join(", ") : "(none)"
  );

  const dataStr = JSON.stringify(
    { patterns: patternData, anti_patterns: antiPatternData, session_samples: sessionSample },
    null,
    2
  ).slice(0, 25_000);

  const response = await callGemini(
    [{ role: "user", parts: [{ text: prompt + "\n\nData:\n" + dataStr }] }],
    undefined,
    { temperature: TEMPERATURE.report }
  );

  let skills: GeneratedSkill[] = [];
  try {
    const cleaned = response.text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      skills = parsed.filter(
        (s: any) => s.name && s.description && s.skill_body && Array.isArray(s.trigger_phrases)
      );
    }
  } catch {
    console.error("[skill-gen] Failed to parse Gemini response:", response.text.slice(0, 200));
  }

  return {
    generatedSkills: skills,
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

// --- Node 3: Deduplicate and filter ---

function deduplicateAndFilter(
  state: SkillGenStateType
): Partial<SkillGenStateType> {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const existingNormalized = state.existingSkillNames.map(normalize);

  const filtered = state.generatedSkills.filter(skill => {
    const norm = normalize(skill.name);
    return !existingNormalized.some(
      existing => existing === norm || existing.includes(norm) || norm.includes(existing)
    );
  });

  // Deduplicate within the batch
  const seen = new Set<string>();
  const unique = filtered.filter(skill => {
    const norm = normalize(skill.name);
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });

  return { generatedSkills: unique };
}

// --- Node 4: Persist skills ---

async function persistSkills(
  state: SkillGenStateType,
  sql: SQL
): Promise<Partial<SkillGenStateType>> {
  const persisted: TeamSkill[] = [];

  for (const skill of state.generatedSkills) {
    // Resolve source pattern IDs
    const sourcePatternIds = state.effectivePatterns
      .filter(p => skill.source_pattern_names?.includes(p.name))
      .map(p => p.id);

    const sourceAntiPatternIds = state.antiPatterns
      .filter(ap => skill.source_anti_pattern_names?.includes(ap.name))
      .map(ap => ap.id);

    try {
      const created = await createTeamSkill(sql, {
        organization_id: state.orgId,
        name: skill.name,
        description: skill.description,
        trigger_phrases: skill.trigger_phrases,
        skill_body: skill.skill_body,
        source_pattern_ids: sourcePatternIds,
        source_anti_pattern_ids: sourceAntiPatternIds,
        generation_context: { rationale: skill.rationale },
        status: "draft",
        created_by: "auto",
      });

      // Create pattern links
      for (const patternId of sourcePatternIds) {
        await linkSkillToPattern(sql, {
          skill_id: created.id,
          pattern_id: patternId,
          link_type: "source_pattern",
        });
      }
      for (const apId of sourceAntiPatternIds) {
        await linkSkillToPattern(sql, {
          skill_id: created.id,
          anti_pattern_id: apId,
          link_type: "anti_pattern_solution",
        });
      }

      persisted.push(created);
    } catch (err) {
      console.error("[skill-gen] Failed to persist skill:", skill.name, err);
    }
  }

  return { persistedSkills: persisted };
}

// --- Workflow assembly ---

export function createSkillGenerationWorkflow(sql: SQL) {
  const workflow = new StateGraph(SkillGenState)
    .addNode("gatherData", (state) => gatherData(state, sql))
    .addNode("generateSkills", generateSkills)
    .addNode("deduplicateAndFilter", deduplicateAndFilter)
    .addNode("persistSkills", (state) => persistSkills(state, sql))
    .addEdge(START, "gatherData")
    .addEdge("gatherData", "generateSkills")
    .addEdge("generateSkills", "deduplicateAndFilter")
    .addEdge("deduplicateAndFilter", "persistSkills")
    .addEdge("persistSkills", END);

  return workflow.compile();
}

export async function runSkillGenerationWorkflow(
  sql: SQL,
  orgId: string
): Promise<TeamSkill[]> {
  const app = createSkillGenerationWorkflow(sql);

  const result = await app.invoke({
    orgId,
    effectivePatterns: [],
    antiPatterns: [],
    sessionSequences: [],
    existingSkillNames: [],
    generatedSkills: [],
    persistedSkills: [],
    inputTokens: 0,
    outputTokens: 0,
  });

  await recordTokenUsage(
    sql,
    "team-skill-gen",
    "gemini-2.0-flash",
    result.inputTokens,
    result.outputTokens
  );

  return result.persistedSkills;
}
