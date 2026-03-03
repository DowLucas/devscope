import type { ToolEvent } from "../../db/patternQueries";

export interface DetectedAntiPattern {
  rule: string; name: string; description: string;
  severity: "info" | "warning" | "critical"; suggestion: string; details: Record<string, unknown>;
}

export function detectRetryLoops(sequence: ToolEvent[]): DetectedAntiPattern[] {
  const results: DetectedAntiPattern[] = [];
  let i = 0;
  while (i < sequence.length) {
    const tool = sequence[i].tool_name;
    let consecutive = 0, failCount = 0, j = i;
    while (j < sequence.length && sequence[j].tool_name === tool) { consecutive++; if (!sequence[j].success) failCount++; j++; }
    if (consecutive >= 3 && failCount >= 3) {
      results.push({
        rule: "retry_loop", name: `Retry Loop: ${tool}`,
        description: `Tool "${tool}" was called ${consecutive} times consecutively with ${failCount} failures, indicating a retry loop.`,
        severity: consecutive >= 5 ? "critical" : "warning",
        suggestion: `When "${tool}" fails repeatedly, try a different approach instead of retrying the same call.`,
        details: { tool_name: tool, consecutive_calls: consecutive, consecutive_failures: failCount, start_index: i },
      });
    }
    i = j;
  }
  return results;
}

export function detectFailureCascades(sequence: ToolEvent[]): DetectedAntiPattern[] {
  const results: DetectedAntiPattern[] = [];
  for (let i = 0; i < sequence.length; i++) {
    if (sequence[i].success) continue;
    let cascadeLength = 0; const cascadeTools: string[] = []; let j = i;
    while (j < sequence.length && !sequence[j].success) { cascadeLength++; cascadeTools.push(sequence[j].tool_name); j++; }
    if (cascadeLength >= 4) {
      const uniqueTools = [...new Set(cascadeTools)];
      results.push({
        rule: "failure_cascade", name: "Failure Cascade",
        description: `A cascade of ${cascadeLength} consecutive failures across ${uniqueTools.length} tool(s), triggered by "${sequence[i].tool_name}".`,
        severity: cascadeLength >= 6 ? "critical" : "warning",
        suggestion: `When multiple tools fail in sequence, stop and reassess the approach.`,
        details: { trigger_tool: sequence[i].tool_name, cascade_length: cascadeLength, tools_involved: uniqueTools, start_index: i },
      });
      i = j - 1;
    }
  }
  return results;
}

export function detectAbandonedSessions(sequence: ToolEvent[], sessionEnded: boolean = true): DetectedAntiPattern | null {
  if (!sessionEnded || sequence.length < 5) return null;
  const lastN = sequence.slice(-10);
  const failCount = lastN.filter(t => !t.success).length;
  const failRate = failCount / lastN.length;
  if (failRate >= 0.5) {
    return {
      rule: "abandoned_session", name: "Abandoned Session",
      description: `Session ended with ${Math.round(failRate * 100)}% failure rate in the last ${lastN.length} tool calls.`,
      severity: failRate >= 0.8 ? "critical" : "warning",
      suggestion: "When facing persistent failures, try asking for help or breaking the task into smaller pieces.",
      details: { failure_rate: Math.round(failRate * 1000) / 1000, last_tool_count: lastN.length, fail_count: failCount },
    };
  }
  return null;
}

export function detectAllAntiPatterns(sequence: ToolEvent[], sessionEnded: boolean = true): DetectedAntiPattern[] {
  const results: DetectedAntiPattern[] = [];
  results.push(...detectRetryLoops(sequence));
  results.push(...detectFailureCascades(sequence));
  const abandoned = detectAbandonedSessions(sequence, sessionEnded);
  if (abandoned) results.push(abandoned);
  return results;
}
