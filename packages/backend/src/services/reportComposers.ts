import type { SQL } from "bun";
import type {
  ExecutiveScorecard,
  ManagerSummary,
  AiRoiMetrics,
  KpiMetric,
  TrafficLight,
  TrendDirection,
} from "@devscope/shared";
import {
  getPeriodComparison,
  getSessionStatsSummary,
  getProjectActivity,
  getTeamHealth,
  getFailureClusters,
  getAiRoiEfficiency,
} from "../db";

function trafficLight(delta: number, invertForFailures = false): TrafficLight {
  const d = invertForFailures ? -delta : delta;
  if (d < -20) return "red";
  if (d < -5) return "yellow";
  return "green";
}

function trend(delta: number): TrendDirection {
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}

function makeKpi(
  label: string,
  current: number,
  previous: number,
  delta: number,
  unit?: string,
  invertForFailures = false
): KpiMetric {
  return {
    label,
    value: current,
    previous_value: previous,
    delta_percent: delta,
    trend: trend(delta),
    status: trafficLight(delta, invertForFailures),
    unit,
  };
}

export async function composeExecutiveScorecard(
  sql: SQL,
  days: number,
  developerIds?: string[]
): Promise<ExecutiveScorecard> {
  const [comparison, summary, projects] = await Promise.all([
    getPeriodComparison(sql, days, undefined, developerIds),
    getSessionStatsSummary(sql, undefined, days, developerIds),
    getProjectActivity(sql, undefined, days, developerIds),
  ]);

  const kpis: KpiMetric[] = [
    makeKpi(
      "Active Sessions",
      comparison.current.sessions,
      comparison.previous.sessions,
      comparison.deltas.sessions
    ),
    makeKpi(
      "Active Developers",
      comparison.current.active_developers,
      comparison.previous.active_developers,
      comparison.deltas.active_developers
    ),
    makeKpi(
      "Prompts",
      comparison.current.prompts,
      comparison.previous.prompts,
      comparison.deltas.prompts
    ),
    makeKpi(
      "Tool Failures",
      comparison.current.failures,
      comparison.previous.failures,
      comparison.deltas.failures,
      undefined,
      true
    ),
  ];

  return {
    kpis,
    generated_at: new Date().toISOString(),
    period_days: days,
  };
}

export async function composeManagerSummary(
  sql: SQL,
  days: number,
  developerIds?: string[]
): Promise<ManagerSummary> {
  const [comparison, teamHealth, clusters] = await Promise.all([
    getPeriodComparison(sql, days, undefined, developerIds),
    getTeamHealth(sql, developerIds),
    getFailureClusters(sql, days, developerIds),
  ]);

  return {
    velocity: {
      sessions: makeKpi(
        "Sessions",
        comparison.current.sessions,
        comparison.previous.sessions,
        comparison.deltas.sessions
      ),
      prompts: makeKpi(
        "Prompts",
        comparison.current.prompts,
        comparison.previous.prompts,
        comparison.deltas.prompts
      ),
      tool_calls: makeKpi(
        "Tool Calls",
        comparison.current.tool_calls,
        comparison.previous.tool_calls,
        comparison.deltas.tool_calls
      ),
    },
    failure_clusters: clusters.slice(0, 5).map((c) => ({
      tool_name: c.tool_name,
      session_id: c.session_id,
      fail_count: c.fail_count,
    })),
    sessions_needing_attention: teamHealth.sessionsNeedingAttention.slice(0, 5),
  };
}

export async function composeRoiMetrics(
  sql: SQL,
  days: number,
  developerIds?: string[]
): Promise<AiRoiMetrics> {
  const [comparison, efficiency, projects] = await Promise.all([
    getPeriodComparison(sql, days, undefined, developerIds),
    getAiRoiEfficiency(sql, days, developerIds),
    getProjectActivity(sql, undefined, days, developerIds),
  ]);

  const totalSessionTime = projects.reduce((sum, p) => sum + p.session_count, 0);

  const kpis: KpiMetric[] = [
    makeKpi(
      "Sessions",
      comparison.current.sessions,
      comparison.previous.sessions,
      comparison.deltas.sessions
    ),
    makeKpi(
      "Developers",
      comparison.current.active_developers,
      comparison.previous.active_developers,
      comparison.deltas.active_developers
    ),
    makeKpi(
      "Prompts",
      comparison.current.prompts,
      comparison.previous.prompts,
      comparison.deltas.prompts
    ),
    makeKpi(
      "Tool Calls",
      comparison.current.tool_calls,
      comparison.previous.tool_calls,
      comparison.deltas.tool_calls
    ),
  ];

  const project_allocation = projects.map((p) => ({
    project_name: p.project_name,
    session_count: p.session_count,
    percentage: totalSessionTime > 0
      ? Math.round((p.session_count / totalSessionTime) * 100)
      : 0,
  }));

  return {
    ...efficiency,
    period_days: days,
    kpis,
    project_allocation,
  };
}
