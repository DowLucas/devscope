import { create } from "zustand";
import { apiFetch } from "@/lib/api";

interface ToolMasteryPoint {
  week: string;
  tool_name: string;
  successes: number;
  total: number;
  success_rate: number;
}

interface PatternAdoptionPoint {
  week: string;
  effective_count: number;
  ineffective_count: number;
  neutral_count: number;
}

interface AntiPatternTrendPoint {
  week: string;
  count: number;
  by_rule: Record<string, number>;
}

interface SessionQualityPoint {
  week: string;
  sessions: number;
  avg_success_rate: number;
  avg_tool_calls: number;
}

interface SkillSummary {
  tool_mastery_rate: number;
  anti_pattern_count: number;
  effective_patterns_used: number;
  ineffective_patterns_used: number;
  avg_session_quality: number;
  period_weeks: number;
}

interface SkillState {
  mastery: ToolMasteryPoint[];
  patterns: PatternAdoptionPoint[];
  antiPatterns: AntiPatternTrendPoint[];
  quality: SessionQualityPoint[];
  summary: SkillSummary | null;
  loading: boolean;
  error: string | null;

  fetchMastery: (weeks?: number) => Promise<void>;
  fetchPatterns: (weeks?: number) => Promise<void>;
  fetchAntiPatterns: (weeks?: number) => Promise<void>;
  fetchQuality: (weeks?: number) => Promise<void>;
  fetchSummary: () => Promise<void>;
  fetchAll: (weeks?: number) => Promise<void>;
}

export const useSkillStore = create<SkillState>((set) => ({
  mastery: [],
  patterns: [],
  antiPatterns: [],
  quality: [],
  summary: null,
  loading: true,
  error: null,

  fetchMastery: async (weeks = 12) => {
    try {
      const res = await apiFetch(`/api/skills/mastery?weeks=${weeks}`);
      const data = await res.json();
      set({ mastery: data });
    } catch {
      set({ error: "Failed to load mastery data" });
    }
  },

  fetchPatterns: async (weeks = 12) => {
    try {
      const res = await apiFetch(`/api/skills/patterns?weeks=${weeks}`);
      const data = await res.json();
      set({ patterns: data });
    } catch {
      set({ error: "Failed to load pattern data" });
    }
  },

  fetchAntiPatterns: async (weeks = 12) => {
    try {
      const res = await apiFetch(`/api/skills/anti-patterns?weeks=${weeks}`);
      const data = await res.json();
      set({ antiPatterns: data });
    } catch {
      set({ error: "Failed to load anti-pattern data" });
    }
  },

  fetchQuality: async (weeks = 12) => {
    try {
      const res = await apiFetch(`/api/skills/quality?weeks=${weeks}`);
      const data = await res.json();
      set({ quality: data });
    } catch {
      set({ error: "Failed to load quality data" });
    }
  },

  fetchSummary: async () => {
    try {
      const res = await apiFetch("/api/skills/summary");
      const data = await res.json();
      set({ summary: data });
    } catch {
      set({ error: "Failed to load summary" });
    }
  },

  fetchAll: async (weeks = 12) => {
    set({ loading: true, error: null });
    try {
      const [mastery, patterns, antiPatterns, quality, summary] =
        await Promise.all([
          apiFetch(`/api/skills/mastery?weeks=${weeks}`).then((r) => r.json()),
          apiFetch(`/api/skills/patterns?weeks=${weeks}`).then((r) => r.json()),
          apiFetch(`/api/skills/anti-patterns?weeks=${weeks}`).then((r) =>
            r.json()
          ),
          apiFetch(`/api/skills/quality?weeks=${weeks}`).then((r) => r.json()),
          apiFetch("/api/skills/summary").then((r) => r.json()),
        ]);
      set({ mastery, patterns, antiPatterns, quality, summary, loading: false });
    } catch {
      set({ error: "Failed to load skill data", loading: false });
    }
  },
}));
