// In-memory per-session state for the proactive nudge layer.
// Tracks recent tool calls (with input hashes) so PreToolUse can answer
// "is this the 3rd identical failing call?" in sub-millisecond time, and so
// PostToolUse can dedupe nudges per (session, rule) while a loop is active.
//
// Distinct from frictionDetector's state — that one tracks org-rule windows;
// this one tracks tool-input identity for hard-block decisions.

const MAX_EVENTS_PER_SESSION = 30;
const NUDGE_DEDUP_TTL_MS = 5 * 60 * 1000; // 5 min

interface ToolEvent {
  toolName: string;
  inputHash: string;
  success: boolean;
  timestamp: number;
}

interface StuckState {
  events: ToolEvent[];
  recentNudges: Map<string, number>; // ruleKey -> timestamp
}

const states: Map<string, StuckState> = ((globalThis as any).__stuckStates ??=
  new Map<string, StuckState>());

function getOrCreate(sessionId: string): StuckState {
  let s = states.get(sessionId);
  if (!s) {
    s = { events: [], recentNudges: new Map() };
    states.set(sessionId, s);
  }
  return s;
}

export function recordToolResult(
  sessionId: string,
  toolName: string,
  inputHash: string,
  success: boolean,
): void {
  const s = getOrCreate(sessionId);
  s.events.push({ toolName, inputHash, success, timestamp: Date.now() });
  if (s.events.length > MAX_EVENTS_PER_SESSION) {
    s.events.splice(0, s.events.length - MAX_EVENTS_PER_SESSION);
  }
}

/**
 * How many recent identical (toolName + inputHash) calls failed?
 * Used by PreToolUse to hard-block a 3rd repeat.
 */
export function identicalFailCount(
  sessionId: string,
  toolName: string,
  inputHash: string,
): number {
  const s = states.get(sessionId);
  if (!s) return 0;
  let count = 0;
  // Walk backwards; reset count if we see a successful identical call.
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i];
    if (e.toolName !== toolName || e.inputHash !== inputHash) continue;
    if (e.success) break;
    count++;
  }
  return count;
}

/**
 * Returns true if a nudge for (sessionId, ruleKey) was emitted recently.
 * Otherwise marks it and returns false. Prevents nudge spam during an
 * ongoing loop.
 */
export function shouldDedupNudge(sessionId: string, ruleKey: string): boolean {
  const s = getOrCreate(sessionId);
  const now = Date.now();
  const last = s.recentNudges.get(ruleKey);
  if (last && now - last < NUDGE_DEDUP_TTL_MS) return true;
  s.recentNudges.set(ruleKey, now);
  return false;
}

/**
 * Recent tool calls for a session, oldest first, as plain data.
 *
 * Feeds the stuckness assessment. Deliberately carries no prompt text, no tool
 * input and no file content — only tool names, whether each call succeeded, and
 * a stable identity for the input — so it can be evaluated without sending any
 * developer content off the box.
 */
export function recentToolSummary(
  sessionId: string,
  limit = 12,
): Array<{ tool: string; ok: boolean; repeat_of: number | null }> {
  const s = states.get(sessionId);
  if (!s) return [];

  const slice = s.events.slice(-limit);
  const firstSeen = new Map<string, number>();

  return slice.map((e, i) => {
    const key = `${e.toolName}|${e.inputHash}`;
    const prior = firstSeen.get(key);
    if (prior === undefined) firstSeen.set(key, i);
    return {
      tool: e.toolName,
      ok: e.success,
      // Index of the earlier call with identical tool and input, so the model
      // can see repetition without ever seeing the input itself.
      repeat_of: prior === undefined ? null : prior,
    };
  });
}

export function clearStuckState(sessionId: string): void {
  states.delete(sessionId);
}

// Test-only — reset all state.
export function __resetAllStuckState(): void {
  states.clear();
}
