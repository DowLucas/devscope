import type { SQL } from "bun";
import {
  insertSessionHealthScore,
  getLatestSessionHealth,
} from "../db";
import type { SessionHealthScore, HealthLevel } from "@devscope/shared";

// Lightweight heuristic scorer — no LLM calls, designed for real-time use
// during event ingestion.

interface SessionContext {
  sessionId: string;
  eventType: string;
  toolName?: string;
}

// In-memory rolling counters per session (cleared on session end)
const sessionCounters = new Map<string, {
  toolSuccess: number;
  toolFail: number;
  consecutiveFails: number;
  lastScoreTime: number;
}>();

const SCORE_INTERVAL_MS = 30_000; // Score at most every 30 seconds per session
const MAX_TRACKED_SESSIONS = 1000;

export function getHealthLevel(score: number): HealthLevel {
  if (score >= 70) return "healthy";
  if (score >= 40) return "warning";
  return "critical";
}

export async function scoreSessionHealth(
  sql: SQL,
  ctx: SessionContext
): Promise<SessionHealthScore | null> {
  const { sessionId, eventType, toolName } = ctx;

  // Initialize or get counters
  let counters = sessionCounters.get(sessionId);
  if (!counters) {
    // Evict oldest if too many
    if (sessionCounters.size >= MAX_TRACKED_SESSIONS) {
      const oldest = sessionCounters.keys().next().value;
      if (oldest) sessionCounters.delete(oldest);
    }
    counters = { toolSuccess: 0, toolFail: 0, consecutiveFails: 0, lastScoreTime: 0 };
    sessionCounters.set(sessionId, counters);
  }

  // Update counters
  if (eventType === "tool.complete") {
    counters.toolSuccess++;
    counters.consecutiveFails = 0;
  } else if (eventType === "tool.fail") {
    counters.toolFail++;
    counters.consecutiveFails++;
  }

  // Rate limit scoring
  const now = Date.now();
  if (now - counters.lastScoreTime < SCORE_INTERVAL_MS) {
    return null;
  }
  counters.lastScoreTime = now;

  // Compute score
  const totalTools = counters.toolSuccess + counters.toolFail;
  if (totalTools < 2) return null; // Not enough data

  const successRate = counters.toolSuccess / totalTools;
  const riskFactors: Record<string, unknown> = {};

  let score = 100;

  // Failure rate penalty
  const failureRate = counters.toolFail / totalTools;
  if (failureRate > 0.5) {
    score -= 40;
    riskFactors.high_failure_rate = {
      rate: Math.round(failureRate * 100),
      message: `${Math.round(failureRate * 100)}% tool failure rate`,
    };
  } else if (failureRate > 0.3) {
    score -= 20;
    riskFactors.elevated_failure_rate = {
      rate: Math.round(failureRate * 100),
      message: `${Math.round(failureRate * 100)}% tool failure rate`,
    };
  }

  // Consecutive failure penalty (retry loop detection)
  if (counters.consecutiveFails >= 5) {
    score -= 30;
    riskFactors.retry_loop = {
      consecutive_fails: counters.consecutiveFails,
      message: `${counters.consecutiveFails} consecutive tool failures — possible retry loop`,
    };
  } else if (counters.consecutiveFails >= 3) {
    score -= 15;
    riskFactors.consecutive_failures = {
      consecutive_fails: counters.consecutiveFails,
      message: `${counters.consecutiveFails} consecutive failures`,
    };
  }

  score = Math.max(0, Math.min(100, score));

  // Only persist if score is concerning or significantly changed
  const lastHealth = await getLatestSessionHealth(sql, sessionId);
  if (lastHealth && Math.abs(lastHealth.score - score) < 10) {
    return null; // Not a significant change
  }

  // Find a relevant playbook suggestion if score is low
  let suggestedPlaybookId: string | undefined;
  if (score < 60) {
    const [playbook] = await sql`
      SELECT id FROM playbooks
      WHERE status = 'active'
      ORDER BY created_at DESC LIMIT 1`;
    suggestedPlaybookId = (playbook as any)?.id;
  }

  return insertSessionHealthScore(
    sql,
    sessionId,
    score,
    riskFactors,
    suggestedPlaybookId
  );
}

export function clearSessionCounters(sessionId: string): void {
  sessionCounters.delete(sessionId);
}
