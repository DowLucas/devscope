import type { SQL } from "bun";
import type {
  AiMaturitySnapshot,
  BenchmarkContribution,
  BenchmarkPercentile,
  BenchmarkPosition,
  MarketplacePlaybook,
  MarketplaceAdoption,
  SessionHealthScore,
  TransparencyReport,
} from "@devscope/shared";
import { inList } from "./utils";

// ========== Feature 1: Maturity Index ==========

export async function upsertMaturitySnapshot(
  sql: SQL,
  orgId: string,
  snapshotDate: string,
  overallScore: number,
  dimensions: Record<string, number>,
  narrative: string | null,
  dataContext: Record<string, unknown> = {}
): Promise<AiMaturitySnapshot> {
  const id = crypto.randomUUID();
  const [row] = await sql`
    INSERT INTO ai_maturity_snapshots (id, organization_id, snapshot_date, overall_score, dimensions, narrative, data_context)
    VALUES (${id}, ${orgId}, ${snapshotDate}, ${overallScore}, ${JSON.stringify(dimensions)}, ${narrative}, ${JSON.stringify(dataContext)})
    ON CONFLICT (organization_id, snapshot_date) DO UPDATE
      SET overall_score = EXCLUDED.overall_score,
          dimensions = EXCLUDED.dimensions,
          narrative = EXCLUDED.narrative,
          data_context = EXCLUDED.data_context
    RETURNING *`;
  return row as AiMaturitySnapshot;
}

export async function getMaturityHistory(
  sql: SQL,
  orgId: string,
  days: number = 90
): Promise<AiMaturitySnapshot[]> {
  const rows = await sql`
    SELECT * FROM ai_maturity_snapshots
    WHERE organization_id = ${orgId}
      AND snapshot_date >= CURRENT_DATE - ${days}
    ORDER BY snapshot_date DESC`;
  return rows as AiMaturitySnapshot[];
}

export async function getLatestMaturity(
  sql: SQL,
  orgId: string
): Promise<AiMaturitySnapshot | null> {
  const [row] = await sql`
    SELECT * FROM ai_maturity_snapshots
    WHERE organization_id = ${orgId}
    ORDER BY snapshot_date DESC LIMIT 1`;
  return (row as AiMaturitySnapshot) ?? null;
}

// ========== Feature 3: Benchmarking ==========

export async function upsertBenchmarkContribution(
  sql: SQL,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  metrics: Record<string, number>
): Promise<BenchmarkContribution> {
  const id = crypto.randomUUID();
  const [row] = await sql`
    INSERT INTO benchmark_contributions (id, organization_id, period_start, period_end, metrics)
    VALUES (${id}, ${orgId}, ${periodStart}, ${periodEnd}, ${JSON.stringify(metrics)})
    ON CONFLICT (organization_id, period_start) DO UPDATE
      SET metrics = EXCLUDED.metrics, period_end = EXCLUDED.period_end, contributed_at = NOW()
    RETURNING *`;
  return row as BenchmarkContribution;
}

export async function computeBenchmarkPercentiles(
  sql: SQL,
  periodStart: string
): Promise<void> {
  const metrics = [
    "sessions_per_day", "tool_success_rate", "prompts_per_session",
    "anti_pattern_rate", "agent_delegation_pct", "avg_session_duration_min", "team_size"
  ];

  for (const metric of metrics) {
    // Extract all values for this metric
    const rows = await sql`
      SELECT (metrics->${metric})::NUMERIC as val
      FROM benchmark_contributions
      WHERE period_start = ${periodStart}
        AND metrics ? ${metric}
      ORDER BY val`;

    const values = (rows as any[]).map(r => Number(r.val)).filter(v => !isNaN(v));
    if (values.length < 3) continue; // Need at least 3 orgs for meaningful percentiles

    const p = (pct: number) => {
      const idx = Math.ceil(values.length * pct / 100) - 1;
      return values[Math.max(0, Math.min(idx, values.length - 1))];
    };

    const id = crypto.randomUUID();
    await sql`
      INSERT INTO benchmark_percentiles (id, period_start, metric_name, p25, p50, p75, p90, sample_size)
      VALUES (${id}, ${periodStart}, ${metric}, ${p(25)}, ${p(50)}, ${p(75)}, ${p(90)}, ${values.length})
      ON CONFLICT (period_start, metric_name) DO UPDATE
        SET p25 = EXCLUDED.p25, p50 = EXCLUDED.p50, p75 = EXCLUDED.p75,
            p90 = EXCLUDED.p90, sample_size = EXCLUDED.sample_size, computed_at = NOW()`;
  }
}

export async function getBenchmarkPositions(
  sql: SQL,
  orgId: string,
  periodStart: string
): Promise<BenchmarkPosition[]> {
  // Get org's own contribution
  const [contrib] = await sql`
    SELECT metrics FROM benchmark_contributions
    WHERE organization_id = ${orgId} AND period_start = ${periodStart}`;
  if (!contrib) return [];

  const orgMetrics = typeof (contrib as any).metrics === "string"
    ? JSON.parse((contrib as any).metrics)
    : (contrib as any).metrics;

  // Get percentiles
  const percentiles = await sql`
    SELECT * FROM benchmark_percentiles WHERE period_start = ${periodStart}`;

  return (percentiles as any[]).map(p => {
    const val = orgMetrics[p.metric_name] ?? 0;
    // Compute approximate percentile position
    let percentile = 50;
    if (val <= (p.p25 ?? 0)) percentile = 25;
    else if (val <= (p.p50 ?? 0)) percentile = 50;
    else if (val <= (p.p75 ?? 0)) percentile = 75;
    else percentile = 90;

    return {
      metric_name: p.metric_name,
      value: val,
      percentile,
      p25: p.p25,
      p50: p.p50,
      p75: p.p75,
      p90: p.p90,
    } as BenchmarkPosition;
  });
}

export async function isBenchmarkOptedIn(sql: SQL, orgId: string): Promise<boolean> {
  const [row] = await sql`
    SELECT benchmark_opt_in FROM organization_settings WHERE organization_id = ${orgId}`;
  return !!(row as any)?.benchmark_opt_in;
}

export async function setBenchmarkOptIn(sql: SQL, orgId: string, optIn: boolean): Promise<void> {
  await sql`
    UPDATE organization_settings SET benchmark_opt_in = ${optIn}
    WHERE organization_id = ${orgId}`;
}

// ========== Feature 4: Marketplace ==========

export async function getMarketplacePlaybooks(
  sql: SQL,
  options: { category?: string; limit?: number; offset?: number } = {}
): Promise<MarketplacePlaybook[]> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  if (options.category) {
    return await sql`
      SELECT * FROM marketplace_playbooks
      WHERE status = 'published' AND category = ${options.category}
      ORDER BY adoption_count DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}` as MarketplacePlaybook[];
  }

  return await sql`
    SELECT * FROM marketplace_playbooks
    WHERE status = 'published'
    ORDER BY adoption_count DESC, created_at DESC
    LIMIT ${limit} OFFSET ${offset}` as MarketplacePlaybook[];
}

export async function getMarketplacePlaybook(
  sql: SQL,
  id: string
): Promise<MarketplacePlaybook | null> {
  const [row] = await sql`
    SELECT * FROM marketplace_playbooks WHERE id = ${id}`;
  return (row as MarketplacePlaybook) ?? null;
}

export async function publishToMarketplace(
  sql: SQL,
  playbookId: string,
  orgId: string | null,
  data: {
    name: string;
    description: string;
    tool_sequence: string[];
    when_to_use: string;
    success_metrics: Record<string, unknown>;
    category?: string;
    tags?: string[];
  }
): Promise<MarketplacePlaybook> {
  const id = crypto.randomUUID();
  const [row] = await sql`
    INSERT INTO marketplace_playbooks (
      id, source_playbook_id, source_org_id, name, description,
      tool_sequence, when_to_use, success_metrics, category, tags,
      status, published_at
    ) VALUES (
      ${id}, ${playbookId}, ${orgId}, ${data.name}, ${data.description},
      ${data.tool_sequence}, ${data.when_to_use}, ${JSON.stringify(data.success_metrics)},
      ${data.category ?? null}, ${data.tags ?? []},
      'published', NOW()
    ) RETURNING *`;
  return row as MarketplacePlaybook;
}

export async function adoptMarketplacePlaybook(
  sql: SQL,
  marketplaceId: string,
  orgId: string
): Promise<MarketplaceAdoption> {
  const id = crypto.randomUUID();
  const [row] = await sql`
    INSERT INTO marketplace_adoptions (id, marketplace_playbook_id, adopting_org_id)
    VALUES (${id}, ${marketplaceId}, ${orgId})
    ON CONFLICT (marketplace_playbook_id, adopting_org_id) DO NOTHING
    RETURNING *`;

  // Increment adoption count
  await sql`
    UPDATE marketplace_playbooks
    SET adoption_count = adoption_count + 1
    WHERE id = ${marketplaceId}`;

  return row as MarketplaceAdoption;
}

export async function rateMarketplacePlaybook(
  sql: SQL,
  marketplaceId: string,
  orgId: string,
  rating: number
): Promise<void> {
  await sql`
    UPDATE marketplace_adoptions SET rating = ${rating}
    WHERE marketplace_playbook_id = ${marketplaceId} AND adopting_org_id = ${orgId}`;

  // Recompute average rating
  const [avg] = await sql`
    SELECT AVG(rating)::NUMERIC(3,2) as avg_rating
    FROM marketplace_adoptions
    WHERE marketplace_playbook_id = ${marketplaceId} AND rating IS NOT NULL`;
  await sql`
    UPDATE marketplace_playbooks SET avg_rating = ${(avg as any).avg_rating}
    WHERE id = ${marketplaceId}`;
}

// ========== Feature 5: Session Health ==========

export async function insertSessionHealthScore(
  sql: SQL,
  sessionId: string,
  score: number,
  riskFactors: Record<string, unknown>,
  suggestedPlaybookId?: string,
  suggestedSkillId?: string
): Promise<SessionHealthScore> {
  const id = crypto.randomUUID();
  const [row] = await sql`
    INSERT INTO session_health_scores (id, session_id, score, risk_factors, suggested_playbook_id, suggested_skill_id)
    VALUES (${id}, ${sessionId}, ${score}, ${JSON.stringify(riskFactors)}, ${suggestedPlaybookId ?? null}, ${suggestedSkillId ?? null})
    RETURNING *`;
  return row as SessionHealthScore;
}

export async function getLatestSessionHealth(
  sql: SQL,
  sessionId: string
): Promise<SessionHealthScore | null> {
  const [row] = await sql`
    SELECT * FROM session_health_scores
    WHERE session_id = ${sessionId}
    ORDER BY created_at DESC LIMIT 1`;
  return (row as SessionHealthScore) ?? null;
}

export async function getSessionHealthHistory(
  sql: SQL,
  sessionId: string
): Promise<SessionHealthScore[]> {
  return await sql`
    SELECT * FROM session_health_scores
    WHERE session_id = ${sessionId}
    ORDER BY created_at ASC` as SessionHealthScore[];
}

// ========== Feature 6: Transparency Report ==========

export async function getTransparencyReport(
  sql: SQL,
  orgId: string,
  days: number = 30
): Promise<TransparencyReport> {
  // Ethics summary
  const ethicsSummary = await sql`
    SELECT event_type, COUNT(*)::INT as count
    FROM ethics_audit_log
    WHERE (organization_id = ${orgId} OR organization_id IS NULL)
      AND created_at >= NOW() - make_interval(days => ${days})
    GROUP BY event_type`;

  const byType: Record<string, number> = {};
  let totalEvents = 0;
  for (const row of ethicsSummary as any[]) {
    byType[row.event_type] = row.count;
    totalEvents += row.count;
  }

  // Consent overview
  const [consent] = await sql`
    SELECT
      COUNT(DISTINCT d.id)::INT as total_developers,
      COUNT(DISTINCT CASE WHEN dp.share_details = TRUE THEN d.id END)::INT as sharing_details,
      COUNT(DISTINCT CASE WHEN dp.privacy_mode = 'private' THEN d.id END)::INT as privacy_mode_count
    FROM organization_developer od
    JOIN developers d ON d.id = od.developer_id
    LEFT JOIN developer_privacy_preferences dp ON dp.developer_id = d.id
    WHERE od.organization_id = ${orgId}`;

  const consentData = consent as any;
  const totalDevs = consentData?.total_developers ?? 0;
  const privacyCount = consentData?.privacy_mode_count ?? 0;

  // Data retention settings
  const [settings] = await sql`
    SELECT retention_days FROM organization_settings WHERE organization_id = ${orgId}`;
  const retentionDays = (settings as any)?.retention_days ?? 90;

  const purgeCount = byType["retention_purge_executed"] ?? 0;

  return {
    period_days: days,
    ethics_summary: {
      total_events: totalEvents,
      by_type: byType,
    },
    consent_overview: {
      total_developers: totalDevs,
      sharing_details: consentData?.sharing_details ?? 0,
      privacy_mode_count: privacyCount,
    },
    guardrail_activations: {
      individual_references_blocked: byType["ai_individual_reference_blocked"] ?? 0,
      sensitive_fields_stripped: byType["sensitive_fields_stripped"] ?? 0,
    },
    data_retention: {
      retention_days: retentionDays,
      purges_executed: purgeCount,
    },
    privacy_mode_adoption_rate: totalDevs > 0 ? (privacyCount / totalDevs) * 100 : 0,
  };
}

// ========== Maturity Data Gathering ==========

export async function gatherMaturityMetrics(
  sql: SQL,
  orgId: string,
  devIds: string[]
): Promise<Record<string, unknown>> {
  if (devIds.length === 0) return {};

  // Tool adoption breadth - distinct tools used
  const [toolCount] = await sql`
    SELECT COUNT(DISTINCT payload->>'toolName')::INT as unique_tools
    FROM events e
    JOIN sessions s ON s.id = e.session_id
    WHERE s.developer_id IN (${inList(devIds)})
      AND e.event_type IN ('tool.complete', 'tool.fail')
      AND e.created_at >= NOW() - INTERVAL '7 days'`;

  // Workflow efficiency - effective pattern matches vs anti-pattern matches
  const [patterns] = await sql`
    SELECT
      (SELECT COUNT(*)::INT FROM session_pattern_matches spm
       JOIN sessions s ON s.id = spm.session_id
       WHERE s.developer_id IN (${inList(devIds)})
         AND spm.created_at >= NOW() - INTERVAL '7 days') as pattern_matches,
      (SELECT COUNT(*)::INT FROM session_anti_pattern_matches sapm
       JOIN sessions s ON s.id = sapm.session_id
       WHERE s.developer_id IN (${inList(devIds)})
         AND sapm.created_at >= NOW() - INTERVAL '7 days') as anti_pattern_matches`;

  // Failure recovery - tool failure rate trend
  const [failures] = await sql`
    SELECT
      COUNT(CASE WHEN e.event_type = 'tool.fail' THEN 1 END)::INT as fail_count,
      COUNT(CASE WHEN e.event_type = 'tool.complete' THEN 1 END)::INT as success_count
    FROM events e
    JOIN sessions s ON s.id = e.session_id
    WHERE s.developer_id IN (${inList(devIds)})
      AND e.event_type IN ('tool.complete', 'tool.fail')
      AND e.created_at >= NOW() - INTERVAL '7 days'`;

  // Skill adoption - approved/active skills + usage
  const [skills] = await sql`
    SELECT
      COUNT(CASE WHEN status IN ('approved', 'active') THEN 1 END)::INT as active_skills,
      COALESCE(SUM(adoption_count), 0)::INT as total_adoption
    FROM team_skills
    WHERE organization_id = ${orgId}`;

  // AI collaboration - agent delegation events
  const [agents] = await sql`
    SELECT COUNT(*)::INT as agent_starts
    FROM events e
    JOIN sessions s ON s.id = e.session_id
    WHERE s.developer_id IN (${inList(devIds)})
      AND e.event_type = 'agent.start'
      AND e.created_at >= NOW() - INTERVAL '7 days'`;

  // Session count for normalization
  const [sessionCount] = await sql`
    SELECT COUNT(*)::INT as total_sessions
    FROM sessions
    WHERE developer_id IN (${inList(devIds)})
      AND started_at >= NOW() - INTERVAL '7 days'`;

  return {
    unique_tools: (toolCount as any)?.unique_tools ?? 0,
    pattern_matches: (patterns as any)?.pattern_matches ?? 0,
    anti_pattern_matches: (patterns as any)?.anti_pattern_matches ?? 0,
    fail_count: (failures as any)?.fail_count ?? 0,
    success_count: (failures as any)?.success_count ?? 0,
    active_skills: (skills as any)?.active_skills ?? 0,
    total_skill_adoption: (skills as any)?.total_adoption ?? 0,
    agent_starts: (agents as any)?.agent_starts ?? 0,
    total_sessions: (sessionCount as any)?.total_sessions ?? 0,
  };
}

// ========== Benchmark Data Gathering ==========

export async function gatherBenchmarkMetrics(
  sql: SQL,
  orgId: string,
  devIds: string[],
  days: number = 7
): Promise<Record<string, number>> {
  if (devIds.length === 0) return {};

  const [stats] = await sql`
    SELECT
      COUNT(DISTINCT s.id)::INT as total_sessions,
      COUNT(CASE WHEN e.event_type = 'tool.complete' THEN 1 END)::INT as tool_success,
      COUNT(CASE WHEN e.event_type = 'tool.fail' THEN 1 END)::INT as tool_fail,
      COUNT(CASE WHEN e.event_type = 'prompt.submit' THEN 1 END)::INT as prompts,
      COUNT(CASE WHEN e.event_type = 'agent.start' THEN 1 END)::INT as agent_starts,
      AVG(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at)) / 60)::NUMERIC(10,2) as avg_duration_min
    FROM sessions s
    LEFT JOIN events e ON e.session_id = s.id
    WHERE s.developer_id IN (${inList(devIds)})
      AND s.started_at >= NOW() - make_interval(days => ${days})`;

  const s = stats as any;
  const totalSessions = s?.total_sessions ?? 0;
  const toolTotal = (s?.tool_success ?? 0) + (s?.tool_fail ?? 0);

  // Anti-pattern rate
  const [ap] = await sql`
    SELECT COUNT(*)::INT as anti_patterns
    FROM session_anti_pattern_matches sapm
    JOIN sessions sess ON sess.id = sapm.session_id
    WHERE sess.developer_id IN (${inList(devIds)})
      AND sapm.created_at >= NOW() - make_interval(days => ${days})`;

  return {
    sessions_per_day: days > 0 ? totalSessions / days : 0,
    tool_success_rate: toolTotal > 0 ? ((s?.tool_success ?? 0) / toolTotal) * 100 : 0,
    prompts_per_session: totalSessions > 0 ? (s?.prompts ?? 0) / totalSessions : 0,
    anti_pattern_rate: totalSessions > 0 ? ((ap as any)?.anti_patterns ?? 0) / totalSessions : 0,
    agent_delegation_pct: totalSessions > 0 ? ((s?.agent_starts ?? 0) / totalSessions) * 100 : 0,
    avg_session_duration_min: Number(s?.avg_duration_min ?? 0),
    team_size: devIds.length,
  };
}
