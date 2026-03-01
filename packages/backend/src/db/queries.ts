import type { SQL } from "bun";
import type { DevscopeEvent } from "@devscope/shared";
import type {
  ActivityDataPoint,
  ToolUsageDataPoint,
  SessionStatsDataPoint,
  SessionStatsSummary,
  ProjectActivityDataPoint,
  DeveloperLeaderboardEntry,
  HourlyDistributionPoint,
  PeriodComparisonResult,
  DeveloperComparisonEntry,
  ToolFailureRatePoint,
  FailureCluster,
  AlertRule,
  AlertEvent,
  TeamHealthData,
  DeveloperHealthEntry,
  StuckSession,
  WorkloadEntry,
  ProjectDetail,
  ProjectContributor,
  DigestSummary,
  DigestEntry,
} from "@devscope/shared";

export async function upsertDeveloper(
  sql: SQL,
  id: string,
  name: string,
  email: string
) {
  await sql`
    INSERT INTO developers (id, name, email, first_seen, last_seen)
    VALUES (${id}, ${name}, ${email}, NOW(), NOW())
    ON CONFLICT(id) DO UPDATE SET
      name = ${name},
      email = CASE WHEN ${email} != '' THEN ${email} ELSE developers.email END,
      last_seen = NOW()`;
}

export async function createSession(
  sql: SQL,
  id: string,
  developerId: string,
  projectPath: string,
  projectName: string,
  permissionMode: string | null
) {
  await sql`
    INSERT INTO sessions (id, developer_id, project_path, project_name, permission_mode)
    VALUES (${id}, ${developerId}, ${projectPath}, ${projectName}, ${permissionMode})
    ON CONFLICT(id) DO UPDATE SET
      permission_mode = COALESCE(EXCLUDED.permission_mode, sessions.permission_mode),
      status = 'active',
      ended_at = NULL`;
}

export async function endSession(sql: SQL, id: string) {
  await sql`UPDATE sessions SET status = 'ended', ended_at = NOW() WHERE id = ${id}`;
}

export async function insertEvent(sql: SQL, event: DevscopeEvent) {
  // Pass stringified JSON without ::jsonb cast — Bun.sql handles the
  // parameterisation and PostgreSQL will accept a text value for a jsonb column.
  // Previously JSON.stringify + ::jsonb double-encoded the payload as a JSONB string.
  const payloadJson = JSON.stringify(event.payload ?? {});
  await sql`
    INSERT INTO events (id, session_id, event_type, payload, created_at)
    VALUES (${event.id}, ${event.sessionId}, ${event.eventType}, ${payloadJson}, ${event.timestamp}::timestamptz)`;
}

export async function getActiveAgents(sql: SQL) {
  return await sql`
    SELECT
      e.payload->>'agentId'   AS agent_id,
      e.payload->>'agentType' AS agent_type,
      e.session_id,
      e.created_at AS started_at
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    WHERE e.event_type = 'agent.start'
      AND s.status = 'active'
      AND e.payload->>'agentId' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM events stop
        WHERE stop.event_type = 'agent.stop'
          AND stop.session_id = e.session_id
          AND stop.payload->>'agentId' = e.payload->>'agentId'
      )
    ORDER BY e.created_at ASC`;
}

export async function getActiveSessions(sql: SQL) {
  return await sql`
    SELECT s.*, d.name as developer_name, d.email as developer_email
    FROM sessions s
    JOIN developers d ON s.developer_id = d.id
    WHERE s.status = 'active'
    ORDER BY s.started_at DESC`;
}

export async function getAllDevelopers(sql: SQL) {
  return await sql`
    SELECT d.*,
      (SELECT COUNT(*)::INT FROM sessions WHERE developer_id = d.id AND status = 'active') as active_sessions
    FROM developers d
    ORDER BY d.last_seen DESC`;
}

export async function getRecentEvents(sql: SQL, limit: number = 50) {
  return await sql`
    SELECT e.*, s.developer_id, s.project_path, s.project_name,
           d.name as developer_name, d.email as developer_email
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    JOIN developers d ON s.developer_id = d.id
    ORDER BY e.created_at DESC
    LIMIT ${limit}`;
}

export async function getSessionEvents(sql: SQL, sessionId: string) {
  return await sql`
    SELECT * FROM events WHERE session_id = ${sessionId} ORDER BY created_at ASC`;
}

export async function getStaleActiveSessions(sql: SQL, thresholdMinutes: number) {
  return await sql`
    SELECT s.*, d.name as developer_name, d.email as developer_email
    FROM sessions s
    JOIN developers d ON s.developer_id = d.id
    WHERE s.status = 'active'
      AND COALESCE(
        (SELECT MAX(e.created_at) FROM events e WHERE e.session_id = s.id),
        s.started_at
      ) < NOW() - make_interval(mins => ${thresholdMinutes})`;
}

export async function getAllSessions(sql: SQL, limit: number = 50) {
  return await sql`
    SELECT s.*, d.name as developer_name, d.email as developer_email,
      (SELECT COUNT(*)::INT FROM events WHERE session_id = s.id) as event_count,
      (SELECT COUNT(*)::INT FROM events
       WHERE session_id = s.id
         AND event_type = 'session.start'
         AND (payload->>'continued')::boolean = true) as context_clear_count
    FROM sessions s
    JOIN developers d ON s.developer_id = d.id
    ORDER BY s.started_at DESC
    LIMIT ${limit}`;
}

// --- Session Detail ---

export async function getSessionDetail(sql: SQL, sessionId: string) {
  const [session] = await sql`
    SELECT s.*, d.name as developer_name, d.email as developer_email,
      (SELECT COUNT(*)::INT FROM events WHERE session_id = s.id) as event_count
    FROM sessions s
    JOIN developers d ON s.developer_id = d.id
    WHERE s.id = ${sessionId}`;

  if (!session) return null;

  const events = await sql`
    SELECT * FROM events WHERE session_id = ${sessionId} ORDER BY created_at ASC`;

  return { session, events };
}

// --- Insights aggregation queries ---

export async function getDeveloperActivityOverTime(
  sql: SQL,
  developerId?: string,
  days: number = 30
): Promise<ActivityDataPoint[]> {
  if (developerId) {
    return (await sql`
      SELECT
        e.created_at::DATE as day,
        COUNT(*)::INT as total_events,
        COUNT(DISTINCT e.session_id)::INT as sessions,
        SUM(CASE WHEN e.event_type = 'prompt.submit' THEN 1 ELSE 0 END)::INT as prompts,
        SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.fail', 'tool.start') THEN 1 ELSE 0 END)::INT as tool_calls
      FROM events e
      JOIN sessions s ON e.session_id = s.id
      WHERE e.created_at >= NOW() - make_interval(days => ${days})
        AND s.developer_id = ${developerId}
      GROUP BY e.created_at::DATE
      ORDER BY day ASC`) as ActivityDataPoint[];
  }
  return (await sql`
    SELECT
      e.created_at::DATE as day,
      COUNT(*)::INT as total_events,
      COUNT(DISTINCT e.session_id)::INT as sessions,
      SUM(CASE WHEN e.event_type = 'prompt.submit' THEN 1 ELSE 0 END)::INT as prompts,
      SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.fail', 'tool.start') THEN 1 ELSE 0 END)::INT as tool_calls
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    WHERE e.created_at >= NOW() - make_interval(days => ${days})
    GROUP BY e.created_at::DATE
    ORDER BY day ASC`) as ActivityDataPoint[];
}

export async function getToolUsageBreakdown(
  sql: SQL,
  developerId?: string,
  days: number = 30
): Promise<ToolUsageDataPoint[]> {
  if (developerId) {
    return (await sql`
      SELECT
        e.payload->>'toolName' as tool_name,
        SUM(CASE WHEN e.event_type = 'tool.complete' THEN 1 ELSE 0 END)::INT as success_count,
        SUM(CASE WHEN e.event_type = 'tool.fail' THEN 1 ELSE 0 END)::INT as fail_count,
        COUNT(*)::INT as total
      FROM events e
      JOIN sessions s ON e.session_id = s.id
      WHERE e.event_type IN ('tool.complete', 'tool.fail')
        AND e.payload->>'toolName' IS NOT NULL
        AND e.created_at >= NOW() - make_interval(days => ${days})
        AND s.developer_id = ${developerId}
      GROUP BY tool_name
      ORDER BY total DESC
      LIMIT 15`) as ToolUsageDataPoint[];
  }
  return (await sql`
    SELECT
      e.payload->>'toolName' as tool_name,
      SUM(CASE WHEN e.event_type = 'tool.complete' THEN 1 ELSE 0 END)::INT as success_count,
      SUM(CASE WHEN e.event_type = 'tool.fail' THEN 1 ELSE 0 END)::INT as fail_count,
      COUNT(*)::INT as total
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    WHERE e.event_type IN ('tool.complete', 'tool.fail')
      AND e.payload->>'toolName' IS NOT NULL
      AND e.created_at >= NOW() - make_interval(days => ${days})
    GROUP BY tool_name
    ORDER BY total DESC
    LIMIT 15`) as ToolUsageDataPoint[];
}

export async function getSessionStats(
  sql: SQL,
  developerId?: string,
  days: number = 30
): Promise<SessionStatsDataPoint[]> {
  if (developerId) {
    return (await sql`
      SELECT
        s.started_at::DATE as day,
        COUNT(*)::INT as session_count,
        ROUND(AVG(
          CASE WHEN s.ended_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60
            ELSE NULL
          END
        )::NUMERIC, 1)::FLOAT as avg_duration_minutes,
        ROUND(SUM(
          CASE WHEN s.ended_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60
            ELSE 0
          END
        )::NUMERIC, 1)::FLOAT as total_duration_minutes
      FROM sessions s
      WHERE s.started_at >= NOW() - make_interval(days => ${days})
        AND s.developer_id = ${developerId}
      GROUP BY s.started_at::DATE
      ORDER BY day ASC`) as SessionStatsDataPoint[];
  }
  return (await sql`
    SELECT
      s.started_at::DATE as day,
      COUNT(*)::INT as session_count,
      ROUND(AVG(
        CASE WHEN s.ended_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60
          ELSE NULL
        END
      )::NUMERIC, 1)::FLOAT as avg_duration_minutes,
      ROUND(SUM(
        CASE WHEN s.ended_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60
          ELSE 0
        END
      )::NUMERIC, 1)::FLOAT as total_duration_minutes
    FROM sessions s
    WHERE s.started_at >= NOW() - make_interval(days => ${days})
    GROUP BY s.started_at::DATE
    ORDER BY day ASC`) as SessionStatsDataPoint[];
}

export async function getSessionStatsSummary(
  sql: SQL,
  developerId?: string,
  days: number = 30
): Promise<SessionStatsSummary> {
  let result: SessionStatsSummary | undefined;
  if (developerId) {
    [result] = await sql`
      SELECT
        COUNT(*)::INT as total_sessions,
        ROUND(AVG(
          CASE WHEN s.ended_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60
            ELSE NULL
          END
        )::NUMERIC, 1)::FLOAT as avg_duration_minutes,
        COUNT(DISTINCT s.started_at::DATE)::INT as active_days,
        COUNT(DISTINCT s.developer_id)::INT as unique_developers
      FROM sessions s
      WHERE s.started_at >= NOW() - make_interval(days => ${days})
        AND s.developer_id = ${developerId}`;
  } else {
    [result] = await sql`
      SELECT
        COUNT(*)::INT as total_sessions,
        ROUND(AVG(
          CASE WHEN s.ended_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60
            ELSE NULL
          END
        )::NUMERIC, 1)::FLOAT as avg_duration_minutes,
        COUNT(DISTINCT s.started_at::DATE)::INT as active_days,
        COUNT(DISTINCT s.developer_id)::INT as unique_developers
      FROM sessions s
      WHERE s.started_at >= NOW() - make_interval(days => ${days})`;
  }

  return result ?? {
    total_sessions: 0,
    avg_duration_minutes: 0,
    active_days: 0,
    unique_developers: 0,
  };
}

export async function getProjectActivity(
  sql: SQL,
  developerId?: string,
  days: number = 30
): Promise<ProjectActivityDataPoint[]> {
  if (developerId) {
    return (await sql`
      SELECT
        s.project_name,
        s.project_path,
        COUNT(DISTINCT s.id)::INT as session_count,
        COUNT(e.id)::INT as event_count,
        ROUND((SUM(
          CASE WHEN s.ended_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60
            ELSE 0
          END
        ) / GREATEST(COUNT(DISTINCT s.id), 1))::NUMERIC, 1)::FLOAT as total_minutes
      FROM sessions s
      LEFT JOIN events e ON e.session_id = s.id
      WHERE s.started_at >= NOW() - make_interval(days => ${days})
        AND s.developer_id = ${developerId}
      GROUP BY s.project_name, s.project_path
      ORDER BY event_count DESC
      LIMIT 10`) as ProjectActivityDataPoint[];
  }
  return (await sql`
    SELECT
      s.project_name,
      s.project_path,
      COUNT(DISTINCT s.id)::INT as session_count,
      COUNT(e.id)::INT as event_count,
      ROUND((SUM(
        CASE WHEN s.ended_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60
          ELSE 0
        END
      ) / GREATEST(COUNT(DISTINCT s.id), 1))::NUMERIC, 1)::FLOAT as total_minutes
    FROM sessions s
    LEFT JOIN events e ON e.session_id = s.id
    WHERE s.started_at >= NOW() - make_interval(days => ${days})
    GROUP BY s.project_name, s.project_path
    ORDER BY event_count DESC
    LIMIT 10`) as ProjectActivityDataPoint[];
}

export async function getDeveloperLeaderboard(
  sql: SQL,
  days: number = 30
): Promise<DeveloperLeaderboardEntry[]> {
  return (await sql`
    SELECT
      d.id,
      d.name,
      d.email,
      COUNT(DISTINCT s.id)::INT as total_sessions,
      COUNT(e.id)::INT as total_events,
      SUM(CASE WHEN e.event_type = 'prompt.submit' THEN 1 ELSE 0 END)::INT as total_prompts,
      SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.fail', 'tool.start') THEN 1 ELSE 0 END)::INT as total_tool_calls,
      MAX(e.created_at) as last_active
    FROM developers d
    LEFT JOIN sessions s ON s.developer_id = d.id
      AND s.started_at >= NOW() - make_interval(days => ${days})
    LEFT JOIN events e ON e.session_id = s.id
    GROUP BY d.id
    ORDER BY total_events DESC`) as DeveloperLeaderboardEntry[];
}

export async function getHourlyDistribution(
  sql: SQL,
  developerId?: string,
  days: number = 30
): Promise<HourlyDistributionPoint[]> {
  if (developerId) {
    return (await sql`
      SELECT
        EXTRACT(HOUR FROM e.created_at)::INT as hour,
        COUNT(*)::INT as event_count
      FROM events e
      JOIN sessions s ON e.session_id = s.id
      WHERE e.created_at >= NOW() - make_interval(days => ${days})
        AND s.developer_id = ${developerId}
      GROUP BY EXTRACT(HOUR FROM e.created_at)
      ORDER BY hour ASC`) as HourlyDistributionPoint[];
  }
  return (await sql`
    SELECT
      EXTRACT(HOUR FROM e.created_at)::INT as hour,
      COUNT(*)::INT as event_count
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    WHERE e.created_at >= NOW() - make_interval(days => ${days})
    GROUP BY EXTRACT(HOUR FROM e.created_at)
    ORDER BY hour ASC`) as HourlyDistributionPoint[];
}

// --- Period Comparison ---

export async function getPeriodComparison(
  sql: SQL,
  days: number = 7,
  developerId?: string
): Promise<PeriodComparisonResult> {
  async function getMetrics(startDays: number, endDays: number) {
    if (developerId) {
      const [row] = await sql`
        SELECT
          COUNT(DISTINCT s.id)::INT as sessions,
          SUM(CASE WHEN e.event_type = 'prompt.submit' THEN 1 ELSE 0 END)::INT as prompts,
          SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.start') THEN 1 ELSE 0 END)::INT as tool_calls,
          SUM(CASE WHEN e.event_type = 'tool.fail' THEN 1 ELSE 0 END)::INT as failures,
          COUNT(DISTINCT s.developer_id)::INT as active_developers
        FROM events e
        JOIN sessions s ON e.session_id = s.id
        WHERE e.created_at >= NOW() - make_interval(days => ${startDays})
          AND e.created_at < NOW() - make_interval(days => ${endDays})
          AND s.developer_id = ${developerId}`;
      return row;
    }
    const [row] = await sql`
      SELECT
        COUNT(DISTINCT s.id)::INT as sessions,
        SUM(CASE WHEN e.event_type = 'prompt.submit' THEN 1 ELSE 0 END)::INT as prompts,
        SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.start') THEN 1 ELSE 0 END)::INT as tool_calls,
        SUM(CASE WHEN e.event_type = 'tool.fail' THEN 1 ELSE 0 END)::INT as failures,
        COUNT(DISTINCT s.developer_id)::INT as active_developers
      FROM events e
      JOIN sessions s ON e.session_id = s.id
      WHERE e.created_at >= NOW() - make_interval(days => ${startDays})
        AND e.created_at < NOW() - make_interval(days => ${endDays})`;
    return row;
  }

  const current = await getMetrics(days, 0);
  const previous = await getMetrics(days * 2, days);

  const safeDiv = (a: number, b: number) => b === 0 ? 0 : Math.round(((a - b) / b) * 100);

  return {
    current: {
      sessions: current?.sessions ?? 0,
      prompts: current?.prompts ?? 0,
      tool_calls: current?.tool_calls ?? 0,
      failures: current?.failures ?? 0,
      active_developers: current?.active_developers ?? 0,
    },
    previous: {
      sessions: previous?.sessions ?? 0,
      prompts: previous?.prompts ?? 0,
      tool_calls: previous?.tool_calls ?? 0,
      failures: previous?.failures ?? 0,
      active_developers: previous?.active_developers ?? 0,
    },
    deltas: {
      sessions: safeDiv(current?.sessions ?? 0, previous?.sessions ?? 0),
      prompts: safeDiv(current?.prompts ?? 0, previous?.prompts ?? 0),
      tool_calls: safeDiv(current?.tool_calls ?? 0, previous?.tool_calls ?? 0),
      failures: safeDiv(current?.failures ?? 0, previous?.failures ?? 0),
      active_developers: safeDiv(current?.active_developers ?? 0, previous?.active_developers ?? 0),
    },
  };
}

// --- Developer Comparison ---

export async function getDeveloperComparison(
  sql: SQL,
  developerIds: string[],
  days: number = 30
): Promise<DeveloperComparisonEntry[]> {
  if (developerIds.length === 0) return [];

  return (await sql`
    SELECT
      d.id, d.name, d.email,
      COUNT(DISTINCT s.id)::INT as sessions,
      SUM(CASE WHEN e.event_type = 'prompt.submit' THEN 1 ELSE 0 END)::INT as prompts,
      SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.start') THEN 1 ELSE 0 END)::INT as tool_calls,
      SUM(CASE WHEN e.event_type = 'tool.fail' THEN 1 ELSE 0 END)::INT as failures,
      ROUND(AVG(
        CASE WHEN s.ended_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60
          ELSE NULL
        END
      )::NUMERIC, 1)::FLOAT as avg_session_minutes
    FROM developers d
    LEFT JOIN sessions s ON s.developer_id = d.id
      AND s.started_at >= NOW() - make_interval(days => ${days})
    LEFT JOIN events e ON e.session_id = s.id
    WHERE d.id = ANY(${developerIds})
    GROUP BY d.id`) as DeveloperComparisonEntry[];
}

// --- Tool Failure Analysis ---

export async function getToolFailureRates(
  sql: SQL,
  days: number = 30,
  developerId?: string
): Promise<ToolFailureRatePoint[]> {
  if (developerId) {
    return (await sql`
      SELECT
        e.created_at::DATE as day,
        e.payload->>'toolName' as tool_name,
        SUM(CASE WHEN e.event_type = 'tool.complete' THEN 1 ELSE 0 END)::INT as success_count,
        SUM(CASE WHEN e.event_type = 'tool.fail' THEN 1 ELSE 0 END)::INT as fail_count,
        ROUND(
          (SUM(CASE WHEN e.event_type = 'tool.fail' THEN 1 ELSE 0 END)::NUMERIC /
          GREATEST(COUNT(*), 1)), 3
        )::FLOAT as failure_rate
      FROM events e
      JOIN sessions s ON e.session_id = s.id
      WHERE e.event_type IN ('tool.complete', 'tool.fail')
        AND e.payload->>'toolName' IS NOT NULL
        AND e.created_at >= NOW() - make_interval(days => ${days})
        AND s.developer_id = ${developerId}
      GROUP BY day, tool_name
      ORDER BY day ASC, fail_count DESC`) as ToolFailureRatePoint[];
  }
  return (await sql`
    SELECT
      e.created_at::DATE as day,
      e.payload->>'toolName' as tool_name,
      SUM(CASE WHEN e.event_type = 'tool.complete' THEN 1 ELSE 0 END)::INT as success_count,
      SUM(CASE WHEN e.event_type = 'tool.fail' THEN 1 ELSE 0 END)::INT as fail_count,
      ROUND(
        (SUM(CASE WHEN e.event_type = 'tool.fail' THEN 1 ELSE 0 END)::NUMERIC /
        GREATEST(COUNT(*), 1)), 3
      )::FLOAT as failure_rate
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    WHERE e.event_type IN ('tool.complete', 'tool.fail')
      AND e.payload->>'toolName' IS NOT NULL
      AND e.created_at >= NOW() - make_interval(days => ${days})
    GROUP BY day, tool_name
    ORDER BY day ASC, fail_count DESC`) as ToolFailureRatePoint[];
}

export async function getFailureClusters(
  sql: SQL,
  days: number = 30
): Promise<FailureCluster[]> {
  const rows = await sql`
    SELECT
      e.payload->>'toolName' as tool_name,
      e.session_id,
      d.name as developer_name,
      COUNT(*)::INT as fail_count,
      STRING_AGG(COALESCE(e.payload->>'errorMessage', ''), '|||') as error_messages_raw
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    JOIN developers d ON s.developer_id = d.id
    WHERE e.event_type = 'tool.fail'
      AND e.created_at >= NOW() - make_interval(days => ${days})
    GROUP BY e.payload->>'toolName', e.session_id, d.name
    HAVING COUNT(*) >= 2
    ORDER BY fail_count DESC
    LIMIT 50`;

  return (rows as any[]).map((r) => ({
    tool_name: r.tool_name,
    session_id: r.session_id,
    developer_name: r.developer_name,
    fail_count: r.fail_count,
    error_messages: (r.error_messages_raw || "")
      .split("|||")
      .filter((m: string) => m.length > 0)
      .slice(0, 5),
  }));
}

// --- Alert Rules CRUD ---

export async function getAlertRules(sql: SQL): Promise<AlertRule[]> {
  return (await sql`SELECT * FROM alert_rules ORDER BY created_at DESC`) as AlertRule[];
}

export async function createAlertRule(
  sql: SQL,
  rule: Omit<AlertRule, "id" | "created_at">
): Promise<AlertRule> {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO alert_rules (id, rule_type, threshold, window_minutes, tool_name, enabled)
    VALUES (${id}, ${rule.rule_type}, ${rule.threshold}, ${rule.window_minutes}, ${rule.tool_name}, ${rule.enabled})`;
  const [created] = await sql`SELECT * FROM alert_rules WHERE id = ${id}`;
  return created as AlertRule;
}

export async function updateAlertRule(
  sql: SQL,
  id: string,
  updates: Partial<Omit<AlertRule, "id" | "created_at">>
) {
  if (updates.rule_type !== undefined) {
    await sql`UPDATE alert_rules SET rule_type = ${updates.rule_type} WHERE id = ${id}`;
  }
  if (updates.threshold !== undefined) {
    await sql`UPDATE alert_rules SET threshold = ${updates.threshold} WHERE id = ${id}`;
  }
  if (updates.window_minutes !== undefined) {
    await sql`UPDATE alert_rules SET window_minutes = ${updates.window_minutes} WHERE id = ${id}`;
  }
  if (updates.tool_name !== undefined) {
    await sql`UPDATE alert_rules SET tool_name = ${updates.tool_name} WHERE id = ${id}`;
  }
  if (updates.enabled !== undefined) {
    await sql`UPDATE alert_rules SET enabled = ${updates.enabled} WHERE id = ${id}`;
  }
}

export async function deleteAlertRule(sql: SQL, id: string) {
  await sql`DELETE FROM alert_rules WHERE id = ${id}`;
}

export async function getRecentAlerts(sql: SQL, limit: number = 50): Promise<AlertEvent[]> {
  return (await sql`
    SELECT ae.*, d.name as developer_name
    FROM alert_events ae
    LEFT JOIN developers d ON ae.developer_id = d.id
    ORDER BY ae.triggered_at DESC
    LIMIT ${limit}`) as AlertEvent[];
}

export async function acknowledgeAlert(sql: SQL, id: string) {
  await sql`UPDATE alert_events SET acknowledged = TRUE WHERE id = ${id}`;
}

export async function checkAlertThresholds(
  sql: SQL,
  sessionId: string,
  toolName: string
): Promise<AlertEvent | null> {
  const rules = await sql`SELECT * FROM alert_rules WHERE enabled = TRUE` as AlertRule[];

  for (const rule of rules) {
    if (rule.tool_name && rule.tool_name !== toolName) continue;

    let failCount: any;
    if (rule.tool_name) {
      [failCount] = await sql`
        SELECT COUNT(*)::INT as cnt FROM events
        WHERE session_id = ${sessionId}
          AND event_type = 'tool.fail'
          AND created_at >= NOW() - make_interval(mins => ${rule.window_minutes})
          AND payload->>'toolName' = ${rule.tool_name}`;
    } else {
      [failCount] = await sql`
        SELECT COUNT(*)::INT as cnt FROM events
        WHERE session_id = ${sessionId}
          AND event_type = 'tool.fail'
          AND created_at >= NOW() - make_interval(mins => ${rule.window_minutes})`;
    }

    if (failCount && failCount.cnt >= rule.threshold) {
      const [existing] = await sql`
        SELECT id FROM alert_events
        WHERE rule_id = ${rule.id} AND session_id = ${sessionId}
          AND triggered_at >= NOW() - make_interval(mins => ${rule.window_minutes})`;

      if (!existing) {
        const [session] = await sql`SELECT developer_id FROM sessions WHERE id = ${sessionId}`;
        const alertId = crypto.randomUUID();
        await sql`
          INSERT INTO alert_events (id, rule_id, session_id, developer_id, tool_name, failure_count, triggered_at, acknowledged)
          VALUES (${alertId}, ${rule.id}, ${sessionId}, ${(session as any)?.developer_id ?? ""}, ${toolName}, ${failCount.cnt}, NOW(), FALSE)`;
        const [alert] = await sql`
          SELECT ae.*, d.name as developer_name FROM alert_events ae
          LEFT JOIN developers d ON ae.developer_id = d.id
          WHERE ae.id = ${alertId}`;
        return alert as AlertEvent;
      }
    }
  }
  return null;
}

// --- Team Health ---

export async function getTeamHealth(sql: SQL): Promise<TeamHealthData> {
  const allDevs = await sql`
    SELECT d.id, d.name, d.email, d.last_seen,
      (SELECT COUNT(*)::INT FROM sessions WHERE developer_id = d.id AND status = 'active') as active_sessions
    FROM developers d
    ORDER BY d.last_seen DESC`;

  const todayMetricsRows = await sql`
    SELECT
      s.developer_id,
      COUNT(DISTINCT s.id)::INT as sessions,
      SUM(CASE WHEN e.event_type = 'prompt.submit' THEN 1 ELSE 0 END)::INT as prompts,
      SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.fail', 'tool.start') THEN 1 ELSE 0 END)::INT as tool_calls
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    WHERE e.created_at::DATE = CURRENT_DATE
    GROUP BY s.developer_id`;

  const todayMetricsMap = new Map<string, any>();
  for (const row of todayMetricsRows) {
    todayMetricsMap.set((row as any).developer_id, row);
  }

  const hourlyRows = await sql`
    SELECT
      s.developer_id,
      EXTRACT(HOUR FROM e.created_at)::INT as hour,
      COUNT(*)::INT as cnt
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    WHERE e.created_at::DATE = CURRENT_DATE
    GROUP BY s.developer_id, EXTRACT(HOUR FROM e.created_at)`;

  const hourlyMap = new Map<string, number[]>();
  for (const row of hourlyRows as any[]) {
    if (!hourlyMap.has(row.developer_id)) {
      hourlyMap.set(row.developer_id, new Array(24).fill(0));
    }
    hourlyMap.get(row.developer_id)![row.hour] = row.cnt;
  }

  const developers: DeveloperHealthEntry[] = (allDevs as any[]).map((dev) => {
    const lastSeenTime = new Date(dev.last_seen).getTime();
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let status: "active" | "idle" | "offline" = "offline";
    if (dev.active_sessions > 0) status = "active";
    else if (lastSeenTime > oneHourAgo) status = "idle";

    const todayMetrics = todayMetricsMap.get(dev.id);
    const hourlyActivity = hourlyMap.get(dev.id) ?? new Array(24).fill(0);

    return {
      id: dev.id,
      name: dev.name,
      email: dev.email,
      status,
      today_sessions: todayMetrics?.sessions ?? 0,
      today_prompts: todayMetrics?.prompts ?? 0,
      today_tool_calls: todayMetrics?.tool_calls ?? 0,
      hourly_activity: hourlyActivity,
    };
  });

  // Velocity
  async function weekMetrics(startDays: number, endDays: number) {
    const [row] = await sql`
      SELECT
        COUNT(DISTINCT s.id)::INT as sessions,
        SUM(CASE WHEN e.event_type = 'prompt.submit' THEN 1 ELSE 0 END)::INT as prompts,
        SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.start') THEN 1 ELSE 0 END)::INT as tool_calls
      FROM events e
      JOIN sessions s ON e.session_id = s.id
      WHERE e.created_at >= NOW() - make_interval(days => ${startDays})
        AND e.created_at < NOW() - make_interval(days => ${endDays})`;
    return row as any;
  }

  const cw = await weekMetrics(7, 0);
  const pw = await weekMetrics(14, 7);
  const safeDiv = (a: number, b: number) => b === 0 ? 0 : Math.round(((a - b) / b) * 100);

  const velocity = {
    current_week: { sessions: cw?.sessions ?? 0, prompts: cw?.prompts ?? 0, tool_calls: cw?.tool_calls ?? 0 },
    previous_week: { sessions: pw?.sessions ?? 0, prompts: pw?.prompts ?? 0, tool_calls: pw?.tool_calls ?? 0 },
    percent_change: {
      sessions: safeDiv(cw?.sessions ?? 0, pw?.sessions ?? 0),
      prompts: safeDiv(cw?.prompts ?? 0, pw?.prompts ?? 0),
      tool_calls: safeDiv(cw?.tool_calls ?? 0, pw?.tool_calls ?? 0),
    },
  };

  // Stuck sessions
  const stuckRows = await sql`
    SELECT
      s.id as session_id,
      d.name as developer_name,
      s.project_name,
      ROUND((EXTRACT(EPOCH FROM (NOW() - COALESCE(
        (SELECT MAX(e2.created_at) FROM events e2 WHERE e2.session_id = s.id),
        s.started_at
      ))) / 60)::NUMERIC, 1)::FLOAT as idle_minutes,
      ROUND(
        (SUM(CASE WHEN e.event_type = 'tool.fail' THEN 1 ELSE 0 END)::NUMERIC /
        GREATEST(SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.fail') THEN 1 ELSE 0 END), 1)), 2
      )::FLOAT as tool_failure_rate
    FROM sessions s
    JOIN developers d ON s.developer_id = d.id
    LEFT JOIN events e ON e.session_id = s.id
    WHERE s.status = 'active'
    GROUP BY s.id, d.name, s.project_name, s.started_at
    HAVING ROUND((EXTRACT(EPOCH FROM (NOW() - COALESCE(
      (SELECT MAX(e2.created_at) FROM events e2 WHERE e2.session_id = s.id),
      s.started_at
    ))) / 60)::NUMERIC, 1) > 5
    OR ROUND(
      (SUM(CASE WHEN e.event_type = 'tool.fail' THEN 1 ELSE 0 END)::NUMERIC /
      GREATEST(SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.fail') THEN 1 ELSE 0 END), 1)), 2
    ) > 0.3
    ORDER BY idle_minutes DESC` as StuckSession[];

  // Workload
  const workload = await sql`
    SELECT
      s.developer_id,
      d.name as developer_name,
      COUNT(DISTINCT s.id)::INT as sessions,
      SUM(CASE WHEN e.event_type = 'prompt.submit' THEN 1 ELSE 0 END)::INT as prompts,
      SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.fail', 'tool.start') THEN 1 ELSE 0 END)::INT as tool_calls
    FROM sessions s
    JOIN developers d ON s.developer_id = d.id
    LEFT JOIN events e ON e.session_id = s.id
    WHERE s.started_at::DATE = CURRENT_DATE
    GROUP BY s.developer_id, d.name
    ORDER BY prompts DESC` as WorkloadEntry[];

  return { developers, velocity, stuckSessions: stuckRows, workload };
}

// --- Project Board ---

export async function getProjectsOverview(
  sql: SQL,
  days: number = 30
): Promise<ProjectDetail[]> {
  return (await sql`
    SELECT
      s.project_name as name,
      s.project_path as path,
      SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END)::INT as active_sessions,
      COUNT(DISTINCT s.id)::INT as total_sessions,
      COUNT(e.id)::INT as total_events,
      ROUND((SUM(
        CASE WHEN s.ended_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60
          ELSE 0
        END
      ) / GREATEST(COUNT(DISTINCT s.id), 1))::NUMERIC, 1)::FLOAT as total_minutes,
      COUNT(DISTINCT s.developer_id)::INT as contributor_count,
      ROUND(
        (SUM(CASE WHEN e.event_type = 'tool.fail' THEN 1 ELSE 0 END)::NUMERIC /
        GREATEST(SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.fail') THEN 1 ELSE 0 END), 1)), 3
      )::FLOAT as failure_rate,
      MAX(e.created_at) as last_activity,
      ROUND(
        ((1 - SUM(CASE WHEN e.event_type = 'tool.fail' THEN 1 ELSE 0 END)::NUMERIC /
        GREATEST(SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.fail') THEN 1 ELSE 0 END), 1)) * 100)
      , 0)::FLOAT as health_score
    FROM sessions s
    LEFT JOIN events e ON e.session_id = s.id
    WHERE s.started_at >= NOW() - make_interval(days => ${days})
    GROUP BY s.project_name, s.project_path
    ORDER BY total_events DESC`) as ProjectDetail[];
}

export async function getProjectContributors(
  sql: SQL,
  projectName: string,
  days: number = 30
): Promise<ProjectContributor[]> {
  return (await sql`
    SELECT
      s.developer_id,
      d.name,
      COUNT(DISTINCT s.id)::INT as session_count,
      SUM(CASE WHEN e.event_type = 'prompt.submit' THEN 1 ELSE 0 END)::INT as prompt_count,
      MAX(e.created_at) as last_active
    FROM sessions s
    JOIN developers d ON s.developer_id = d.id
    LEFT JOIN events e ON e.session_id = s.id
    WHERE s.project_name = ${projectName}
      AND s.started_at >= NOW() - make_interval(days => ${days})
    GROUP BY s.developer_id, d.name
    ORDER BY prompt_count DESC`) as ProjectContributor[];
}

export async function getProjectToolUsage(
  sql: SQL,
  projectName: string,
  days: number = 30
): Promise<ToolUsageDataPoint[]> {
  return (await sql`
    SELECT
      e.payload->>'toolName' as tool_name,
      SUM(CASE WHEN e.event_type = 'tool.complete' THEN 1 ELSE 0 END)::INT as success_count,
      SUM(CASE WHEN e.event_type = 'tool.fail' THEN 1 ELSE 0 END)::INT as fail_count,
      COUNT(*)::INT as total
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    WHERE e.event_type IN ('tool.complete', 'tool.fail')
      AND e.payload->>'toolName' IS NOT NULL
      AND s.project_name = ${projectName}
      AND e.created_at >= NOW() - make_interval(days => ${days})
    GROUP BY tool_name
    ORDER BY total DESC
    LIMIT 15`) as ToolUsageDataPoint[];
}

export async function getProjectActivityOverTime(
  sql: SQL,
  projectName: string,
  days: number = 30
): Promise<ActivityDataPoint[]> {
  return (await sql`
    SELECT
      e.created_at::DATE as day,
      COUNT(*)::INT as total_events,
      COUNT(DISTINCT e.session_id)::INT as sessions,
      SUM(CASE WHEN e.event_type = 'prompt.submit' THEN 1 ELSE 0 END)::INT as prompts,
      SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.fail', 'tool.start') THEN 1 ELSE 0 END)::INT as tool_calls
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    WHERE s.project_name = ${projectName}
      AND e.created_at >= NOW() - make_interval(days => ${days})
    GROUP BY e.created_at::DATE
    ORDER BY day ASC`) as ActivityDataPoint[];
}

// --- Digest / Export ---

export async function generateDigest(
  sql: SQL,
  periodStart: string,
  periodEnd: string,
  digestType: string
): Promise<DigestEntry> {
  const [metrics] = await sql`
    SELECT
      COUNT(DISTINCT s.id)::INT as total_sessions,
      SUM(CASE WHEN e.event_type = 'prompt.submit' THEN 1 ELSE 0 END)::INT as total_prompts,
      SUM(CASE WHEN e.event_type IN ('tool.complete', 'tool.start') THEN 1 ELSE 0 END)::INT as total_tool_calls,
      SUM(CASE WHEN e.event_type = 'tool.fail' THEN 1 ELSE 0 END)::INT as total_failures,
      COUNT(DISTINCT s.developer_id)::INT as active_developers,
      COUNT(DISTINCT s.project_name)::INT as active_projects
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    WHERE e.created_at >= ${periodStart}::TIMESTAMPTZ AND e.created_at < ${periodEnd}::TIMESTAMPTZ`;

  const topDevs = await sql`
    SELECT d.name, SUM(CASE WHEN e.event_type = 'prompt.submit' THEN 1 ELSE 0 END)::INT as prompts
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    JOIN developers d ON s.developer_id = d.id
    WHERE e.created_at >= ${periodStart}::TIMESTAMPTZ AND e.created_at < ${periodEnd}::TIMESTAMPTZ
    GROUP BY d.id, d.name ORDER BY prompts DESC LIMIT 5`;

  const topProjects = await sql`
    SELECT s.project_name as name, COUNT(e.id)::INT as events
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    WHERE e.created_at >= ${periodStart}::TIMESTAMPTZ AND e.created_at < ${periodEnd}::TIMESTAMPTZ
    GROUP BY s.project_name ORDER BY events DESC LIMIT 5`;

  const notableFailures = await sql`
    SELECT e.payload->>'toolName' as tool_name, COUNT(*)::INT as count
    FROM events e
    WHERE e.event_type = 'tool.fail'
      AND e.created_at >= ${periodStart}::TIMESTAMPTZ AND e.created_at < ${periodEnd}::TIMESTAMPTZ
    GROUP BY tool_name ORDER BY count DESC LIMIT 5`;

  const summary: DigestSummary = {
    total_sessions: (metrics as any)?.total_sessions ?? 0,
    total_prompts: (metrics as any)?.total_prompts ?? 0,
    total_tool_calls: (metrics as any)?.total_tool_calls ?? 0,
    total_failures: (metrics as any)?.total_failures ?? 0,
    active_developers: (metrics as any)?.active_developers ?? 0,
    active_projects: (metrics as any)?.active_projects ?? 0,
    top_developers: (topDevs as any[]).map((d) => ({ name: d.name, prompts: d.prompts })),
    top_projects: (topProjects as any[]).map((p) => ({ name: p.name, events: p.events })),
    notable_failures: (notableFailures as any[]).map((f) => ({ tool_name: f.tool_name, count: f.count })),
  };

  const id = crypto.randomUUID();
  await sql`
    INSERT INTO digests (id, digest_type, period_start, period_end, summary, generated_at)
    VALUES (${id}, ${digestType}, ${periodStart}::TIMESTAMPTZ, ${periodEnd}::TIMESTAMPTZ, ${JSON.stringify(summary)}, NOW())`;

  const [digest] = await sql`SELECT * FROM digests WHERE id = ${id}`;
  return digest as any as DigestEntry;
}

export async function getDigests(sql: SQL, limit: number = 20): Promise<DigestEntry[]> {
  const rows = await sql`
    SELECT * FROM digests ORDER BY generated_at DESC LIMIT ${limit}`;

  return (rows as any[]).map((r) => ({
    ...r,
    summary: typeof r.summary === "string" ? JSON.parse(r.summary) : r.summary,
  }));
}

export async function getExportData(
  sql: SQL,
  dataType: string,
  days: number = 30,
  developerId?: string
): Promise<unknown[]> {
  switch (dataType) {
    case "leaderboard":
      return getDeveloperLeaderboard(sql, days);
    case "sessions":
      return getAllSessions(sql, 500);
    case "activity":
      return getDeveloperActivityOverTime(sql, developerId, days);
    case "failures":
      return getToolFailureRates(sql, days, developerId);
    case "tools":
      return getToolUsageBreakdown(sql, developerId, days);
    default:
      return [];
  }
}
