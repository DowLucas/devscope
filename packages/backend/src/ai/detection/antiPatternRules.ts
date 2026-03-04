import type { ToolEvent } from "../../db/patternQueries";

// --- Rule-Based Anti-Pattern Detection ---
// Pure functions that analyze tool sequences and return detected anti-patterns.

export interface DetectedAntiPattern {
  rule: string;
  name: string;
  description: string;
  severity: "info" | "warning" | "critical";
  suggestion: string;
  details: Record<string, unknown>;
}

/**
 * Detect retry loops: same tool called 3+ times consecutively with failures.
 */
export function detectRetryLoops(sequence: ToolEvent[]): DetectedAntiPattern[] {
  const results: DetectedAntiPattern[] = [];
  let i = 0;

  while (i < sequence.length) {
    const tool = sequence[i].tool_name;
    let consecutive = 0;
    let failCount = 0;
    let j = i;

    while (j < sequence.length && sequence[j].tool_name === tool) {
      consecutive++;
      if (!sequence[j].success) failCount++;
      j++;
    }

    if (consecutive >= 3 && failCount >= 3) {
      results.push({
        rule: "retry_loop",
        name: `Repeated ${tool} Failures`,
        description: `Claude Code retried "${tool}" ${consecutive} times with ${failCount} failures. This often happens when the prompt lacks sufficient context or the task needs to be broken into smaller steps.`,
        severity: consecutive >= 5 ? "critical" : "warning",
        suggestion: `Try providing more specific context in your prompt (e.g. exact file paths, function names, or expected behavior). If the task is complex, break it into smaller, focused requests. You can also use /clear to reset context if it's become cluttered.`,
        details: {
          tool_name: tool,
          consecutive_calls: consecutive,
          consecutive_failures: failCount,
          start_index: i,
        },
      });
    }

    i = j;
  }

  return results;
}

/**
 * Detect failure cascades: a tool failure followed by 3+ more failures (any tool).
 */
export function detectFailureCascades(sequence: ToolEvent[]): DetectedAntiPattern[] {
  const results: DetectedAntiPattern[] = [];

  for (let i = 0; i < sequence.length; i++) {
    if (sequence[i].success) continue;

    // Count consecutive failures from this point
    let cascadeLength = 0;
    const cascadeTools: string[] = [];
    let j = i;

    while (j < sequence.length && !sequence[j].success) {
      cascadeLength++;
      cascadeTools.push(sequence[j].tool_name);
      j++;
    }

    if (cascadeLength >= 4) {
      const uniqueTools = [...new Set(cascadeTools)];
      results.push({
        rule: "failure_cascade",
        name: "Cascading Failures",
        description: `${cascadeLength} consecutive failures across ${uniqueTools.length} tool(s) after "${sequence[i].tool_name}" failed. This usually means the initial request was too ambiguous or missing key context.`,
        severity: cascadeLength >= 6 ? "critical" : "warning",
        suggestion: `When Claude Code hits a wall, try rephrasing your request with more constraints — include file paths, expected inputs/outputs, or error messages. Consider using the Agent tool for complex research tasks, or break the work into focused steps.`,
        details: {
          trigger_tool: sequence[i].tool_name,
          cascade_length: cascadeLength,
          tools_involved: uniqueTools,
          start_index: i,
        },
      });
      // Skip past this cascade to avoid overlapping detections
      i = j - 1;
    }
  }

  return results;
}

/**
 * Detect abandoned sessions: session ended with high failure rate in last N tool calls.
 */
export function detectAbandonedSessions(
  sequence: ToolEvent[],
  sessionEnded: boolean = true
): DetectedAntiPattern | null {
  if (!sessionEnded || sequence.length < 5) return null;

  const lastN = sequence.slice(-10);
  const failCount = lastN.filter(t => !t.success).length;
  const failRate = failCount / lastN.length;

  if (failRate >= 0.5) {
    return {
      rule: "abandoned_session",
      name: "Struggling Session",
      description: `Session ended with ${Math.round(failRate * 100)}% failure rate in its final ${lastN.length} tool calls. The task may have been too broad or the context too cluttered for effective work.`,
      severity: failRate >= 0.8 ? "critical" : "warning",
      suggestion: "For complex tasks, try starting a fresh session with /clear or breaking the work into smaller sessions. Providing a CLAUDE.md file with project-specific context can help Claude Code understand your codebase better. Consider using specific file paths and function names in your prompts.",
      details: {
        failure_rate: Math.round(failRate * 1000) / 1000,
        last_tool_count: lastN.length,
        fail_count: failCount,
        last_tools: lastN.map(t => ({ tool: t.tool_name, success: t.success })),
      },
    };
  }

  return null;
}

/**
 * Run all rule-based detectors on a session's tool sequence.
 */
export function detectAllAntiPatterns(
  sequence: ToolEvent[],
  sessionEnded: boolean = true
): DetectedAntiPattern[] {
  const results: DetectedAntiPattern[] = [];

  results.push(...detectRetryLoops(sequence));
  results.push(...detectFailureCascades(sequence));

  const abandoned = detectAbandonedSessions(sequence, sessionEnded);
  if (abandoned) results.push(abandoned);

  return results;
}
