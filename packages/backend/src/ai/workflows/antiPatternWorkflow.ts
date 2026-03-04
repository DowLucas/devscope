import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { callGemini, TEMPERATURE } from "../gemini";
import { getRecentSessionSequences, type SessionSequence } from "../../db/patternQueries";
import { upsertAntiPattern, createAntiPatternMatch } from "../../db/antiPatternQueries";
import { recordTokenUsage } from "../../db";
import { detectAllAntiPatterns, type DetectedAntiPattern } from "../detection/antiPatternRules";
import type { AntiPattern } from "@devscope/shared";

interface SessionAntiPatternHit {
  session_id: string;
  detections: DetectedAntiPattern[];
}

const AntiPatternState = Annotation.Root({
  days: Annotation<number>,
  sequences: Annotation<SessionSequence[]>,
  ruleBasedHits: Annotation<SessionAntiPatternHit[]>,
  classifiedHits: Annotation<SessionAntiPatternHit[]>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
});

type AntiPatternStateType = typeof AntiPatternState.State;

async function fetchSessions(
  state: AntiPatternStateType,
  sql: SQL
): Promise<Partial<AntiPatternStateType>> {
  const sequences = await getRecentSessionSequences(sql, state.days, 200);
  return { sequences };
}

function detectRuleBased(
  state: AntiPatternStateType
): Partial<AntiPatternStateType> {
  const hits: SessionAntiPatternHit[] = [];

  for (const seq of state.sequences) {
    const detections = detectAllAntiPatterns(seq.tools, true);
    if (detections.length > 0) {
      hits.push({ session_id: seq.session_id, detections });
    }
  }

  return { ruleBasedHits: hits };
}

const CLASSIFY_PROMPT = `You are reviewing detected usage issues in Claude Code developer sessions.
Your goal is to help DEVELOPERS improve how they use Claude Code — focus on what the developer can do differently, not on Claude Code's internal behavior.

For each detection below, confirm or refine it:
1. Confirm the severity is appropriate (info/warning/critical)
2. Rewrite the suggestion as developer-facing advice about Claude Code best practices:
   - Suggest specific prompt techniques (be more specific, include file paths, break into steps)
   - Recommend Claude Code features (use /clear, agents for research, CLAUDE.md for context)
   - Advise on task structure (smaller focused sessions, exploration before editing)
3. If a detection is a false positive (e.g. intentional retries), mark severity as "info"
4. Rewrite names to describe the developer's situation, not Claude's internal tool behavior
   - BAD: "Retry Loop: Bash" → GOOD: "Repeated Command Failures"
   - BAD: "Failure Cascade" → GOOD: "Task Needs Clearer Scope"

For each detection, return:
- session_id: the session ID
- rule: the detection rule
- name: refined name (developer-facing, not tool-centric)
- description: refined description (explain what happened from the developer's perspective)
- severity: "info" | "warning" | "critical"
- suggestion: developer-facing advice referencing Claude Code best practices

IMPORTANT: Do not reference individual developers by name, rank, or performance comparisons. All suggestions must be team-level and behavior-focused.

Return a JSON array. Respond with ONLY valid JSON — no markdown, no code fences.`;

async function classifyWithAi(
  state: AntiPatternStateType
): Promise<Partial<AntiPatternStateType>> {
  if (state.ruleBasedHits.length === 0) {
    return { classifiedHits: [] };
  }

  // Prepare data for classification
  const hitsData = state.ruleBasedHits.map(h => ({
    session_id: h.session_id,
    detections: h.detections.map(d => ({
      rule: d.rule,
      name: d.name,
      description: d.description,
      severity: d.severity,
      suggestion: d.suggestion,
      details: d.details,
    })),
  }));

  const dataStr = JSON.stringify(hitsData, null, 2).slice(0, 25_000);

  const response = await callGemini(
    [
      {
        role: "user",
        parts: [{ text: CLASSIFY_PROMPT + "\n\nDetections:\n" + dataStr }],
      },
    ],
    undefined,
    { temperature: TEMPERATURE.insight }
  );

  let classified: any[] = [];
  try {
    const cleaned = response.text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    classified = JSON.parse(cleaned);
    if (!Array.isArray(classified)) classified = [];
  } catch {
    console.error("[anti-pattern] Failed to parse Gemini response:", response.text.slice(0, 200));
    // Fall back to rule-based results as-is
    return {
      classifiedHits: state.ruleBasedHits,
      inputTokens: state.inputTokens + response.inputTokens,
      outputTokens: state.outputTokens + response.outputTokens,
    };
  }

  // Merge AI classifications back into rule-based hits
  const refinedHits: SessionAntiPatternHit[] = state.ruleBasedHits.map(hit => {
    const aiResults = classified.filter((c: any) => c.session_id === hit.session_id);
    if (aiResults.length === 0) return hit;

    const validRules = ["retry_loop", "failure_cascade", "abandoned_session"] as const;
    const refinedDetections = hit.detections.map(d => {
      const aiMatch = aiResults.find((a: any) => a.rule === d.rule);
      if (!aiMatch) return d;
      const validSeverities = ["info", "warning", "critical"] as const;
      return {
        ...d,
        rule: validRules.includes(aiMatch.rule) ? aiMatch.rule : "ai_detected",
        name: aiMatch.name ?? d.name,
        description: aiMatch.description ?? d.description,
        severity: validSeverities.includes(aiMatch.severity) ? aiMatch.severity : d.severity,
        suggestion: aiMatch.suggestion ?? d.suggestion,
      };
    });

    return { session_id: hit.session_id, detections: refinedDetections };
  });

  return {
    classifiedHits: refinedHits,
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

async function persist(
  state: AntiPatternStateType,
  sql: SQL
): Promise<Partial<AntiPatternStateType>> {
  for (const hit of state.classifiedHits) {
    for (const detection of hit.detections) {
      const antiPattern = await upsertAntiPattern(sql, {
        name: detection.name,
        description: detection.description,
        detection_rule: detection.rule,
        severity: detection.severity,
        suggestion: detection.suggestion,
        data_context: detection.details,
      });

      try {
        await createAntiPatternMatch(sql, hit.session_id, antiPattern.id, detection.details);
      } catch {
        // Ignore duplicate or FK constraint violations
      }
    }
  }

  return {};
}

export function createAntiPatternWorkflow(sql: SQL) {
  const workflow = new StateGraph(AntiPatternState)
    .addNode("fetchSessions", (state) => fetchSessions(state, sql))
    .addNode("detectRuleBased", detectRuleBased)
    .addNode("classifyWithAi", classifyWithAi)
    .addNode("persist", (state) => persist(state, sql))
    .addEdge(START, "fetchSessions")
    .addEdge("fetchSessions", "detectRuleBased")
    .addEdge("detectRuleBased", "classifyWithAi")
    .addEdge("classifyWithAi", "persist")
    .addEdge("persist", END);

  return workflow.compile();
}

export async function runAntiPatternWorkflow(
  sql: SQL,
  days: number = 1
): Promise<AntiPattern[]> {
  const app = createAntiPatternWorkflow(sql);

  const result = await app.invoke({
    days,
    sequences: [],
    ruleBasedHits: [],
    classifiedHits: [],
    inputTokens: 0,
    outputTokens: 0,
  });

  await recordTokenUsage(
    sql,
    "anti-patterns",
    "gemini-2.0-flash",
    result.inputTokens,
    result.outputTokens
  );

  const { getAntiPatterns } = await import("../../db/antiPatternQueries");
  return getAntiPatterns(sql, { limit: 20 });
}
