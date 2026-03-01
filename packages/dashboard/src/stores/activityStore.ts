import { create } from "zustand";
import type { DevscopeEvent, Developer, Session, AlertEvent } from "@devscope/shared";

export interface ActiveAgent {
  agentId: string;
  agentType: string;
  sessionId: string;
  startedAt: string;
}

export interface StoppedAgent extends ActiveAgent {
  stoppedAt: number;
}

const MAX_STOPPED_AGENTS = 100;

interface ActivityState {
  events: DevscopeEvent[];
  developers: (Developer & { activeSessions?: number })[];
  activeSessions: Session[];
  activeAgents: ActiveAgent[];
  stoppedAgents: StoppedAgent[];
  endedSessionTimes: Record<string, number>;
  connected: boolean;
  fetchGeneration: number;
  alerts: AlertEvent[];

  addEvent: (event: DevscopeEvent) => void;
  setDevelopers: (devs: Developer[]) => void;
  setActiveSessions: (sessions: Session[]) => void;
  setActiveAgents: (agents: ActiveAgent[]) => void;
  addActiveAgent: (agent: ActiveAgent) => void;
  removeActiveAgent: (agentId: string) => void;
  setConnected: (connected: boolean) => void;
  bumpFetchGeneration: () => void;
  setEvents: (events: DevscopeEvent[]) => void;
  updateSession: (sessionId: string, status: string) => void;
  addAlert: (alert: AlertEvent) => void;
  acknowledgeAlert: (alertId: string) => void;
  cleanupStale: () => void;
}

const MAX_EVENTS = 200;

export const useActivityStore = create<ActivityState>((set) => ({
  events: [],
  developers: [],
  activeSessions: [],
  activeAgents: [],
  stoppedAgents: [],
  endedSessionTimes: {},
  connected: false,
  fetchGeneration: 0,
  alerts: [],

  addEvent: (event) =>
    set((state) => {
      if (state.events.some((e) => e.id === event.id)) return state;
      return { events: [event, ...state.events].slice(0, MAX_EVENTS) };
    }),

  setDevelopers: (developers) => set({ developers }),
  setActiveSessions: (activeSessions) => set({ activeSessions }),
  setActiveAgents: (activeAgents) => set({ activeAgents }),
  addActiveAgent: (agent) =>
    set((state) => {
      if (state.activeAgents.some((a) => a.agentId === agent.agentId)) return state;
      return { activeAgents: [...state.activeAgents, agent] };
    }),
  removeActiveAgent: (agentId) =>
    set((state) => {
      const agent = state.activeAgents.find((a) => a.agentId === agentId);
      return {
        activeAgents: state.activeAgents.filter((a) => a.agentId !== agentId),
        stoppedAgents: agent
          ? [...state.stoppedAgents, { ...agent, stoppedAt: Date.now() }].slice(-MAX_STOPPED_AGENTS)
          : state.stoppedAgents,
      };
    }),
  setConnected: (connected) => set({ connected }),
  bumpFetchGeneration: () => set((state) => ({ fetchGeneration: state.fetchGeneration + 1 })),
  setEvents: (events) => set({ events }),

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
      return {
        activeSessions,
        endedSessionTimes,
        stoppedAgents: state.stoppedAgents.filter((a) => a.stoppedAt > cutoff),
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
