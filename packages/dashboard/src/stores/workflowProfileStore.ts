import { create } from "zustand";
import { apiFetch } from "@/lib/api";
import type { WorkflowProfile, TeamWorkflowSummary } from "@devscope/shared";

interface WorkflowProfileState {
  profile: WorkflowProfile | null;
  history: WorkflowProfile[];
  teamSummary: TeamWorkflowSummary | null;
  loading: boolean;
  error: string | null;

  fetchProfile: () => Promise<void>;
  fetchHistory: () => Promise<void>;
  fetchTeamSummary: () => Promise<void>;
  fetchAll: () => Promise<void>;
}

export const useWorkflowProfileStore = create<WorkflowProfileState>((set) => ({
  profile: null,
  history: [],
  teamSummary: null,
  loading: true,
  error: null,

  fetchProfile: async () => {
    try {
      const res = await apiFetch("/api/workflow-profiles/me");
      if (res.ok) {
        const data = await res.json();
        set({ profile: data });
      }
    } catch {
      // Ignore
    }
  },

  fetchHistory: async () => {
    try {
      const res = await apiFetch("/api/workflow-profiles/me/history?limit=10");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) set({ history: data });
      }
    } catch {
      // Ignore
    }
  },

  fetchTeamSummary: async () => {
    try {
      const res = await apiFetch("/api/workflow-profiles/team-summary");
      if (res.ok) {
        const data = await res.json();
        set({ teamSummary: data });
      }
    } catch {
      // Ignore
    }
  },

  fetchAll: async () => {
    set({ loading: true, error: null });
    try {
      const [profileRes, historyRes, teamRes] = await Promise.all([
        apiFetch("/api/workflow-profiles/me").catch(() => null),
        apiFetch("/api/workflow-profiles/me/history?limit=10").catch(() => null),
        apiFetch("/api/workflow-profiles/team-summary").catch(() => null),
      ]);

      const profile = profileRes?.ok ? await profileRes.json() : null;
      const history = historyRes?.ok ? await historyRes.json() : [];
      const teamSummary = teamRes?.ok ? await teamRes.json() : null;

      set({
        profile,
        history: Array.isArray(history) ? history : [],
        teamSummary,
        loading: false,
      });
    } catch {
      set({ error: "Failed to load workflow profile", loading: false });
    }
  },
}));

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    const state = useWorkflowProfileStore.getState();
    data.state = Object.fromEntries(
      Object.entries(state).filter(([, v]) => typeof v !== "function")
    );
  });
  if (import.meta.hot.data.state) {
    useWorkflowProfileStore.setState(import.meta.hot.data.state);
  }
}
