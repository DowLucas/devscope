import { create } from "zustand";
import type { FeedEvent, Developer, Session, AlertEvent, FrictionAlert } from "@devscope/shared";
import { parseUTC } from "@/lib/utils";

export interface ActiveAgent {
  agentId: string;
  agentType: string;
  /** The Agent tool call's description; plugin 0.31.0+, never for private sessions. */
  description?: string | null;
  model?: string | null;
  sessionId: string;
  startedAt: string;
}

export interface StoppedAgent extends ActiveAgent {
  stoppedAt: number;
}

const MAX_STOPPED_AGENTS = 100;

export interface ToolCounts {
  calls: number;
  failures: number;
}

/** Counts as the API returned them; sessions without them (activity-only) are left out. */
export function toolCountsFrom(sessions: Session[]): Record<string, ToolCounts> {
  const counts: Record<string, ToolCounts> = {};
  for (const s of sessions) {
    if (s.toolCalls != null) counts[s.id] = { calls: s.toolCalls, failures: s.toolFailures ?? 0 };
  }
  return counts;
}

/** Counts a finished tool call live, until the next /api/sessions/active fetch resets them. */
function withToolEvent(counts: Record<string, ToolCounts>, event: FeedEvent): Record<string, ToolCounts> {
  const current = counts[event.sessionId];
  if (!current || (event.eventType !== "tool.complete" && event.eventType !== "tool.fail")) return counts;
  return {
    ...counts,
    [event.sessionId]: {
      calls: current.calls + 1,
      failures: current.failures + (event.eventType === "tool.fail" ? 1 : 0),
    },
  };
}

/** An event of the session itself, not one of its subagents' tool calls. */
function isSessionOwnEvent(event: FeedEvent): boolean {
  if (event.eventType === "agent.start" || event.eventType === "agent.stop") return true;
  return !(event.payload as { agentId?: string } | null)?.agentId;
}

/** Keeps the newest own event per session, so state survives eviction from `events`. */
function withLatestSessionEvents(
  latest: Record<string, FeedEvent>,
  events: FeedEvent[],
): Record<string, FeedEvent> {
  let next = latest;
  for (const event of events) {
    if (!isSessionOwnEvent(event)) continue;
    const current = next[event.sessionId];
    if (current && parseUTC(current.timestamp) >= parseUTC(event.timestamp)) continue;
    if (next === latest) next = { ...latest };
    next[event.sessionId] = event;
  }
  return next;
}

export interface ActivityState {
  events: FeedEvent[];
  /** Newest own event per session, kept beyond the `events` window. */
  latestSessionEvents: Record<string, FeedEvent>;
  toolCounts: Record<string, ToolCounts>;
  developers: (Developer & { activeSessions?: number })[];
  activeSessions: Session[];
  activeAgents: ActiveAgent[];
  stoppedAgents: StoppedAgent[];
  endedSessionTimes: Record<string, number>;
  connected: boolean;
  fetchGeneration: number;
  alerts: AlertEvent[];
  frictionAlerts: FrictionAlert[];

  addEvent: (event: FeedEvent) => void;
  setDevelopers: (devs: Developer[]) => void;
  setActiveSessions: (sessions: Session[]) => void;
  setActiveAgents: (agents: ActiveAgent[]) => void;
  addActiveAgent: (agent: ActiveAgent) => void;
  removeActiveAgent: (agentId: string) => void;
  setConnected: (connected: boolean) => void;
  bumpFetchGeneration: () => void;
  setEvents: (events: FeedEvent[]) => void;
  updateSession: (sessionId: string, status: string) => void;
  updateSessionTitle: (sessionId: string, title: string) => void;
  addAlert: (alert: AlertEvent) => void;
  acknowledgeAlert: (alertId: string) => void;
  addFrictionAlert: (alert: FrictionAlert) => void;
  acknowledgeFrictionAlert: (alertId: string) => void;
  cleanupStale: () => void;
}

const MAX_EVENTS = 200;

export const useActivityStore = create<ActivityState>((set) => ({
  events: [],
  latestSessionEvents: {},
  toolCounts: {},
  developers: [],
  activeSessions: [],
  activeAgents: [],
  stoppedAgents: [],
  endedSessionTimes: {},
  connected: false,
  fetchGeneration: 0,
  alerts: [],
  frictionAlerts: [],

  addEvent: (event) =>
    set((state) => {
      if (state.events.some((e) => e.id === event.id)) return state;
      return {
        events: [event, ...state.events].slice(0, MAX_EVENTS),
        latestSessionEvents: withLatestSessionEvents(state.latestSessionEvents, [event]),
        toolCounts: withToolEvent(state.toolCounts, event),
      };
    }),

  // Ignore non-array payloads (e.g. an `{ error }` body from a 401/429) so a
  // failed fetch can never replace a list with something that crashes `.map`.
  setDevelopers: (developers) => set((state) => (Array.isArray(developers) ? { developers } : state)),
  setActiveSessions: (activeSessions) =>
    set((state) =>
      Array.isArray(activeSessions) ? { activeSessions, toolCounts: toolCountsFrom(activeSessions) } : state,
    ),
  setActiveAgents: (activeAgents) => set((state) => (Array.isArray(activeAgents) ? { activeAgents } : state)),
  addActiveAgent: (agent) =>
    set((state) => {
      if (
        state.activeAgents.some((a) => a.agentId === agent.agentId) ||
        state.stoppedAgents.some((a) => a.agentId === agent.agentId)
      ) return state;
      return { activeAgents: [...state.activeAgents, agent] };
    }),
  removeActiveAgent: (agentId) =>
    set((state) => {
      const agent = state.activeAgents.find((a) => a.agentId === agentId);
      if (!agent) return state;
      return {
        activeAgents: state.activeAgents.filter((a) => a.agentId !== agentId),
        stoppedAgents: [...state.stoppedAgents, { ...agent, stoppedAt: Date.now() }].slice(-MAX_STOPPED_AGENTS),
      };
    }),
  setConnected: (connected) => set({ connected }),
  bumpFetchGeneration: () => set((state) => ({ fetchGeneration: state.fetchGeneration + 1 })),
  setEvents: (events) =>
    set((state) => ({
      events,
      latestSessionEvents: withLatestSessionEvents(state.latestSessionEvents, events),
    })),

  updateSession: (sessionId, status) =>
    set((state) => ({
      activeSessions: state.activeSessions.map((s) =>
        s.id === sessionId ? { ...s, status: status as Session["status"] } : s
      ),
      endedSessionTimes:
        status === "ended"
          ? { ...state.endedSessionTimes, [sessionId]: Date.now() }
          : state.endedSessionTimes,
      activeAgents:
        status === "ended"
          ? state.activeAgents.filter((a) => a.sessionId !== sessionId)
          : state.activeAgents,
      stoppedAgents:
        status === "ended"
          ? [
              ...state.stoppedAgents,
              ...state.activeAgents
                .filter((a) => a.sessionId === sessionId)
                .map((a) => ({ ...a, stoppedAt: Date.now() })),
            ].slice(-MAX_STOPPED_AGENTS)
          : state.stoppedAgents,
    })),

  updateSessionTitle: (sessionId, title) =>
    set((state) => ({
      activeSessions: state.activeSessions.map((s) =>
        s.id === sessionId ? { ...s, currentTitle: title } : s
      ),
    })),

  cleanupStale: () =>
    set((state) => {
      const cutoff = Date.now() - 30_000;
      const removedIds = new Set<string>();
      const activeSessions = state.activeSessions.filter((s) => {
        if (s.status !== "ended") return true;
        const endedAt = state.endedSessionTimes[s.id];
        if (!endedAt || endedAt > cutoff) return true;
        removedIds.add(s.id);
        return false;
      });
      const endedSessionTimes = removedIds.size > 0
        ? Object.fromEntries(Object.entries(state.endedSessionTimes).filter(([id]) => !removedIds.has(id)))
        : state.endedSessionTimes;
      // Finished agents stay (collapsed on the topology) for as long as their session does.
      const sessionIds = new Set(activeSessions.map((s) => s.id));
      return {
        activeSessions,
        endedSessionTimes,
        stoppedAgents: state.stoppedAgents.filter((a) => sessionIds.has(a.sessionId)),
        latestSessionEvents: Object.fromEntries(
          Object.entries(state.latestSessionEvents).filter(([id]) => sessionIds.has(id)),
        ),
      };
    }),

  addAlert: (alert) =>
    set((state) => ({
      alerts: [alert, ...state.alerts].slice(0, 50),
    })),

  acknowledgeAlert: (alertId) =>
    set((state) => ({
      alerts: state.alerts.map((a) =>
        a.id === alertId ? { ...a, acknowledged: true } : a
      ),
    })),

  addFrictionAlert: (alert) =>
    set((state) => {
      if (state.frictionAlerts.some((a) => a.id === alert.id)) return state;
      return { frictionAlerts: [alert, ...state.frictionAlerts].slice(0, 50) };
    }),

  acknowledgeFrictionAlert: (alertId) =>
    set((state) => ({
      frictionAlerts: state.frictionAlerts.map((a) =>
        a.id === alertId ? { ...a, acknowledged: true } : a
      ),
    })),
}));

// Preserve store state across Vite HMR (tree-shaken in production)
if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    const state = useActivityStore.getState();
    data.state = Object.fromEntries(
      Object.entries(state).filter(([, v]) => typeof v !== "function")
    );
  });
  if (import.meta.hot.data.state) {
    useActivityStore.setState(import.meta.hot.data.state);
  }
}
