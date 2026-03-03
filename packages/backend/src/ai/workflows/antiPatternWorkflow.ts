import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { callGemini, TEMPERATURE } from "../gemini";
import { getRecentSessionSequences } from "../../db/patternQueries";
import { upsertAntiPattern, createAntiPatternMatch } from "../../db/antiPatternQueries";
import { recordTokenUsage } from "../../db";
import { detectAllAntiPatterns, type DetectedAntiPattern } from "../detection/antiPatternRules";
import type { SessionSequence } from "../../db/patternQueries";
import type { AntiPattern } from "@devscope/shared";

interface SessionDetection {
  session_id: string;
  detections: DetectedAntiPattern[];
}

interface ClassifiedAntiPattern {
  name: string;
  description: string;
  detection_rule: string;
  severity: string;
  suggestion: string;
  session_ids: string[];
  details: Record<string, unknown>;
}

const AntiPatternState = Annotation.Root({
  days: Annotation<number>,
  sequences: Annotation<SessionSequence[]>,
  ruleDetections: Annotation<SessionDetection[]>,
  classifiedPatterns: Annotation<ClassifiedAntiPattern[]>,
  persistedAntiPatterns: Annotation<AntiPattern[]>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
});

type AntiPatternStateType = typeof AntiPatternState.State;

async function fetchSessions(
  state: AntiPatternStateType,
  sql: SQL
): Promise<Partial<AntiPatternStateType>> {
  const sequences = await getRecentSessionSequences(sql, state.days);
  return { sequences };
}

function detectRuleBased(
  state: AntiPatternStateType
): Partial<AntiPatternStateType> {
  const detections: SessionDetection[] = [];

  for (const seq of state.sequences) {
    const detected = detectAllAntiPatterns(seq.tools, true);
    if (detected.length > 0) {
      detections.push({ session_id: seq.session_id, detections: detected });
    }
  }

  return { ruleDetections: detections };
}

const CLASSIFY_PROMPT = `You are an expert at identifying anti-patterns in developer tool usage.

Given these detected anti-patterns from rule-based analysis, refine them:
1. Merge duplicates across sessions into single anti-patterns
2. Improve the descriptions and suggestions with specific, actionable advice
3. Adjust severity if needed (info, warning, critical)

For each anti-pattern, provide:
- name: A clear, concise name
- description: What went wrong and why it matters
- detection_rule: The original rule (retry_loop, failure_cascade, abandoned_session)
- severity: info | warning | critical
- suggestion: Specific, actionable advice for the developer
- session_ids: Which sessions exhibited this pattern
- details: Any relevant metrics

Respond with ONLY valid JSON — an array of anti-pattern objects. No markdown, no code fences.`;

async function classifyWithAi(
  state: AntiPatternStateType
): Promise<Partial<AntiPatternStateType>> {
  if (state.ruleDetections.length === 0) {
    return { classifiedPatterns: [] };
  }

  const detectionData = state.ruleDetections.map((d) => ({
    session_id: d.session_id,
    detections: d.detections,
  }));

  const dataStr = JSON.stringify(detectionData, null, 2).slice(0, 30_000);

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

  let classified: ClassifiedAntiPattern[] = [];
  try {
    const cleaned = response.text
      .replace(/```json?\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      classified = parsed.filter(
        (p: any) => p.name && p.detection_rule && p.severity
      );
    }
  } catch {
    // If AI classification fails, fall back to rule-based detections
    console.error(
      "[anti-pattern-workflow] Failed to parse Gemini response, using rule-based results"
    );
    classified = state.ruleDetections.flatMap((d) =>
      d.detections.map((det) => ({
        name: det.name,
        description: det.description,
        detection_rule: det.rule,
        severity: det.severity,
        suggestion: det.suggestion,
        session_ids: [d.session_id],
        details: det.details,
      }))
    );
  }

  return {
    classifiedPatterns: classified,
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

async function persist(
  state: AntiPatternStateType,
  sql: SQL
): Promise<Partial<AntiPatternStateType>> {
  const persisted: AntiPattern[] = [];

  for (const cp of state.classifiedPatterns) {
    const ap = await upsertAntiPattern(sql, {
      name: cp.name,
      description: cp.description,
      detection_rule: cp.detection_rule,
      severity: cp.severity,
      suggestion: cp.suggestion,
      occurrence_count: cp.session_ids.length,
      data_context: cp.details,
    });

    for (const sessionId of cp.session_ids) {
      await createAntiPatternMatch(sql, sessionId, ap.id, cp.details);
    }

    persisted.push(ap);
  }

  return { persistedAntiPatterns: persisted };
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
    ruleDetections: [],
    classifiedPatterns: [],
    persistedAntiPatterns: [],
    inputTokens: 0,
    outputTokens: 0,
  });

  await recordTokenUsage(
    sql,
    "anti_patterns",
    "gemini-2.0-flash",
    result.inputTokens,
    result.outputTokens
  );

  return result.persistedAntiPatterns;
}
