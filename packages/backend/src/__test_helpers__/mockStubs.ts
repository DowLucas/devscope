/**
 * No-op stub factories for mock.module calls.
 *
 * Bun's mock.module leaks across test files in the same run — when one file
 * mocks a module with only a subset of exports, other files that import the
 * same module see the incomplete mock and fail with "Export not found".
 *
 * Each mock.module call must provide ALL exports from the real module.
 * These stub factories return complete export objects with no-op defaults.
 * Individual tests override only the functions they care about.
 */
import { mock } from "bun:test";

/** All exports from `../../db` (queries + re-exports). */
export function dbStubs(overrides: Record<string, unknown> = {}) {
  const noop = mock(() => Promise.resolve(null));
  const noopArr = mock(() => Promise.resolve([]));
  return {
    // queries.ts
    initializeDatabase: noop,
    upsertDeveloper: noop,
    createSession: noop,
    endSession: noop,
    insertEvent: noop,
    getActiveAgents: noopArr,
    getActiveSessions: noopArr,
    getAllDevelopers: noopArr,
    getRecentEvents: noopArr,
    getSessionEvents: noopArr,
    getStaleActiveSessions: noopArr,
    getAllSessions: noopArr,
    getSessionDetail: noop,
    getDeveloperActivityOverTime: noopArr,
    getToolUsageBreakdown: noopArr,
    getSessionStats: noopArr,
    getSessionStatsSummary: noop,
    getProjectActivity: noopArr,
    getTeamActivitySummary: noop,
    getHourlyDistribution: noopArr,
    getActivityPerMinute: noopArr,
    getPeriodComparison: noop,
    getToolFailureRates: noopArr,
    getFailureClusters: noopArr,
    getAlertRules: noopArr,
    createAlertRule: noop,
    updateAlertRule: noop,
    deleteAlertRule: noop,
    getRecentAlerts: noopArr,
    acknowledgeAlert: noop,
    checkAlertThresholds: noop,
    getTeamHealth: noop,
    getProjectsOverview: noopArr,
    getProjectContributors: noopArr,
    getProjectToolUsage: noopArr,
    getProjectActivityOverTime: noopArr,
    generateDigest: noop,
    getDigests: noopArr,
    getExportData: noop,
    getAiRoiEfficiency: noop,
    getPublicStats: noop,
    getSessionsNeedingTitles: noopArr,
    getSessionEventsForTitle: noopArr,
    saveSessionTitle: noop,
    getSessionTitleHistory: noopArr,
    // frictionQueries.ts
    insertFrictionAlert: noop,
    getFrictionAlerts: noopArr,
    acknowledgeFrictionAlert: noop,
    getFrictionRules: noopArr,
    seedDefaultFrictionRules: noop,
    // claudeMdQueries.ts
    upsertClaudeMdSnapshot: noop,
    getClaudeMdTimeline: noopArr,
    getClaudeMdProjects: noopArr,
    computeClaudeMdCorrelation: noop,
    // topologyQueries.ts
    computeTeamToolTopology: noop,
    getTeamToolTopology: noopArr,
    detectSkillGaps: noop,
    getTeamSkillGaps: noopArr,
    // workflowProfileQueries.ts
    upsertWorkflowProfile: noop,
    getWorkflowProfile: noop,
    getWorkflowProfileHistory: noopArr,
    getTeamWorkflowSummary: noop,
    ...overrides,
  };
}

/** All exports from `../../ws/handler`. */
export function wsHandlerStubs(overrides: Record<string, unknown> = {}) {
  return {
    addClient: mock(() => {}),
    removeClient: mock(() => {}),
    broadcastToOrg: mock(() => {}),
    broadcast: mock(() => {}),
    getClientCount: mock(() => 0),
    ...overrides,
  };
}

/** All exports from `../../utils/stripSensitiveFields`. */
export function stripSensitiveFieldsStubs(overrides: Record<string, unknown> = {}) {
  return {
    stripSensitivePayload: mock((payload: Record<string, unknown>) => {
      const stripped = { ...payload };
      delete stripped.promptText;
      delete stripped.toolInput;
      delete stripped.responseText;
      return stripped;
    }),
    stripSensitiveEvent: mock((event: Record<string, unknown>) => {
      if (!event.payload || typeof event.payload !== "object") return event;
      const payload = event.payload as Record<string, unknown>;
      const stripped = { ...payload };
      delete stripped.promptText;
      delete stripped.toolInput;
      delete stripped.responseText;
      return { ...event, payload: stripped };
    }),
    ...overrides,
  };
}

/** All exports from `../../services/developerLink`. */
export function developerLinkStubs(overrides: Record<string, unknown> = {}) {
  return {
    computeDeveloperId: mock((_email: string) => "mock-dev-id"),
    linkUserToDeveloper: mock(() => Promise.resolve()),
    getDeveloperIdForUser: mock(() => Promise.resolve(null)),
    getOrgDeveloperIds: mock(() => Promise.resolve([])),
    autoLinkDeveloperToOrg: mock(() => Promise.resolve()),
    autoLinkUserToDeveloper: mock(() => Promise.resolve()),
    ...overrides,
  };
}
