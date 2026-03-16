import type { FrictionAlert, FrictionRule, FrictionRuleType } from "@devscope/shared";
import type { DevscopeEvent, ToolEventPayload, PromptEventPayload } from "@devscope/shared";

interface SessionFrictionState {
  recentFailures: Array<{ toolName: string; timestamp: number }>;
  recentPromptLengths: Array<{ length: number; timestamp: number }>;
  lastProgressTimestamp: number;
  consecutiveFailCount: number;
}

// Store on globalThis for HMR safety (same pattern as WS clients)
const sessionStates = ((globalThis as any).__frictionStates ??= new Map<
  string,
  SessionFrictionState
>());

function getOrCreateState(sessionId: string): SessionFrictionState {
  if (!sessionStates.has(sessionId)) {
    sessionStates.set(sessionId, {
      recentFailures: [],
      recentPromptLengths: [],
      lastProgressTimestamp: Date.now(),
      consecutiveFailCount: 0,
    });
  }
  return sessionStates.get(sessionId)!;
}

function cleanupOldEntries(state: SessionFrictionState, windowMs: number): void {
  const cutoff = Date.now() - windowMs;
  state.recentFailures = state.recentFailures.filter((e) => e.timestamp >= cutoff);
  state.recentPromptLengths = state.recentPromptLengths.filter((e) => e.timestamp >= cutoff);
}

export function cleanupFrictionSession(sessionId: string): void {
  sessionStates.delete(sessionId);
}

type AlertCandidate = Omit<FrictionAlert, "id" | "organization_id" | "triggered_at">;

export function evaluateFriction(
  sessionId: string,
  event: DevscopeEvent,
  rules: FrictionRule[]
): AlertCandidate | null {
  const state = getOrCreateState(sessionId);
  const maxWindowMs = 10 * 60 * 1000; // 10 minutes

  // Clean stale entries before evaluating
  cleanupOldEntries(state, maxWindowMs);

  const enabledRules = rules.filter((r) => r.enabled);

  if (event.eventType === "tool.fail") {
    const payload = event.payload as ToolEventPayload;
    const toolName = payload.toolName ?? "unknown";
    const now = Date.now();

    state.recentFailures.push({ toolName, timestamp: now });
    state.consecutiveFailCount += 1;

    // Check each enabled rule
    for (const rule of enabledRules) {
      if (rule.rule_type === "repeated_failure") {
        const cfg = rule.config as { threshold?: number; windowMinutes?: number };
        const threshold = (cfg.threshold as number) ?? 3;
        const windowMs = ((cfg.windowMinutes as number) ?? 5) * 60 * 1000;
        const cutoff = now - windowMs;

        const relevantFailures = state.recentFailures.filter(
          (f) => f.toolName === toolName && f.timestamp >= cutoff
        );

        if (relevantFailures.length >= threshold) {
          return {
            session_id: sessionId,
            developer_id: event.developerId,
            rule_id: rule.id ?? null,
            rule_type: "repeated_failure" as FrictionRuleType,
            severity: "warning",
            title: `Repeated failures: ${toolName}`,
            description: `Tool "${toolName}" has failed ${relevantFailures.length} times in the last ${cfg.windowMinutes ?? 5} minutes.`,
            data_context: {
              toolName,
              failureCount: relevantFailures.length,
              threshold,
              windowMinutes: cfg.windowMinutes ?? 5,
            },
            acknowledged: false,
          };
        }
      }

      if (rule.rule_type === "failure_cascade") {
        const cfg = rule.config as { uniqueTools?: number; windowMinutes?: number };
        const uniqueToolsThreshold = (cfg.uniqueTools as number) ?? 3;
        const windowMs = ((cfg.windowMinutes as number) ?? 5) * 60 * 1000;
        const cutoff = now - windowMs;

        const recentTools = state.recentFailures
          .filter((f) => f.timestamp >= cutoff)
          .map((f) => f.toolName);

        const uniqueFailedTools = new Set(recentTools);

        if (uniqueFailedTools.size >= uniqueToolsThreshold) {
          return {
            session_id: sessionId,
            developer_id: event.developerId,
            rule_id: rule.id ?? null,
            rule_type: "failure_cascade" as FrictionRuleType,
            severity: "critical",
            title: "Failure cascade detected",
            description: `${uniqueFailedTools.size} different tools have failed in the last ${cfg.windowMinutes ?? 5} minutes.`,
            data_context: {
              uniqueTools: Array.from(uniqueFailedTools),
              uniqueToolCount: uniqueFailedTools.size,
              threshold: uniqueToolsThreshold,
              windowMinutes: cfg.windowMinutes ?? 5,
            },
            acknowledged: false,
          };
        }
      }
    }
  }

  if (event.eventType === "prompt.submit") {
    const payload = event.payload as PromptEventPayload;
    const promptLength = payload.promptLength ?? 0;
    const now = Date.now();

    state.recentPromptLengths.push({ length: promptLength, timestamp: now });

    for (const rule of enabledRules) {
      if (rule.rule_type === "escalating_prompts") {
        const cfg = rule.config as { increasePercent?: number; minPrompts?: number };
        const increasePercent = (cfg.increasePercent as number) ?? 50;
        const minPrompts = (cfg.minPrompts as number) ?? 3;

        if (state.recentPromptLengths.length >= minPrompts) {
          const window = state.recentPromptLengths.slice(-minPrompts);
          const first = window[0].length;
          const last = window[window.length - 1].length;

          if (first > 0 && ((last - first) / first) * 100 >= increasePercent) {
            return {
              session_id: sessionId,
              developer_id: event.developerId,
              rule_id: rule.id ?? null,
              rule_type: "escalating_prompts" as FrictionRuleType,
              severity: "warning",
              title: "Escalating prompt lengths",
              description: `Prompt lengths have increased by ${Math.round(((last - first) / first) * 100)}% over the last ${minPrompts} prompts.`,
              data_context: {
                firstLength: first,
                lastLength: last,
                increasePercent: Math.round(((last - first) / first) * 100),
                minPrompts,
                prompts: window.map((p) => p.length),
              },
              acknowledged: false,
            };
          }
        }
      }
    }
  }

  if (event.eventType === "tool.complete" || event.eventType === "response.complete") {
    state.lastProgressTimestamp = Date.now();
    state.consecutiveFailCount = 0;
  }

  return null;
}
