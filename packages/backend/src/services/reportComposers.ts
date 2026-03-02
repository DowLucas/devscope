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
  getBurnoutRiskSignals,
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
  days: number
): Promise<ExecutiveScorecard> {
  const [comparison, summary, projects] = await Promise.all([
    getPeriodComparison(sql, days),
    getSessionStatsSummary(sql, undefined, days),
    getProjectActivity(sql, undefined, days),
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
  days: number
): Promise<ManagerSummary> {
  const [comparison, teamHealth, clusters, burnout] = await Promise.all([
    getPeriodComparison(sql, days),
    getTeamHealth(sql),
    getFailureClusters(sql, days),
    getBurnoutRiskSignals(sql, days),
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
    burnout_risks: burnout,
    failure_clusters: clusters.slice(0, 5).map((c) => ({
      tool_name: c.tool_name,
      session_id: c.session_id,
      developer_name: c.developer_name,
      fail_count: c.fail_count,
    })),
    stuck_sessions: teamHealth.stuckSessions.slice(0, 5),
  };
}

export async function composeRoiMetrics(
  sql: SQL,
  days: number
): Promise<AiRoiMetrics> {
  const [comparison, efficiency, projects] = await Promise.all([
    getPeriodComparison(sql, days),
    getAiRoiEfficiency(sql, days),
    getProjectActivity(sql, undefined, days),
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
