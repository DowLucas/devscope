import { create } from "zustand";
import type { GroundcontrolEvent, Developer, Session } from "@groundcontrol/shared";

interface ActivityState {
  events: GroundcontrolEvent[];
  developers: (Developer & { active_sessions?: number })[];
  activeSessions: Session[];
  connected: boolean;

  addEvent: (event: GroundcontrolEvent) => void;
  setDevelopers: (devs: Developer[]) => void;
  setActiveSessions: (sessions: Session[]) => void;
  setConnected: (connected: boolean) => void;
  setEvents: (events: GroundcontrolEvent[]) => void;
  updateSession: (sessionId: string, status: string) => void;
}

const MAX_EVENTS = 200;

export const useActivityStore = create<ActivityState>((set) => ({
  events: [],
  developers: [],
  activeSessions: [],
  connected: false,

  addEvent: (event) =>
    set((state) => ({
      events: [event, ...state.events].slice(0, MAX_EVENTS),
    })),

  setDevelopers: (developers) => set({ developers }),
  setActiveSessions: (activeSessions) => set({ activeSessions }),
  setConnected: (connected) => set({ connected }),
  setEvents: (events) => set({ events }),

  updateSession: (sessionId, status) =>
    set((state) => ({
      activeSessions:
        status === "ended"
          ? state.activeSessions.filter((s) => s.id !== sessionId)
          : state.activeSessions,
    })),
}));
