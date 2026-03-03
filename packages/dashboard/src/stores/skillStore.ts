import { create } from "zustand";
import { apiFetch } from "@/lib/api";

interface ToolMasteryEntry {
  week: string;
  tool_name: string;
  successes: number;
  total: number;
  success_rate: number;
}

interface PatternAdoptionEntry {
  week: string;
  effective_count: number;
  ineffective_count: number;
  neutral_count: number;
}

interface AntiPatternEntry {
  week: string;
  count: number;
  by_rule: Record<string, number>;
}

interface SessionQualityEntry {
  week: string;
  sessions: number;
  avg_success_rate: number;
  avg_tool_calls: number;
}

interface SkillSummary {
  patterns: {
    total_patterns: number;
    effective_count: number;
    ineffective_count: number;
    recent_matches: number;
  };
  antiPatterns: {
    total_anti_patterns: number;
    critical_count: number;
    warning_count: number;
    recent_matches: number;
  };
  personal: {
    tools_used: number;
    avg_success_rate: number;
    recent_sessions: number;
    recent_quality: number;
  } | null;
}

interface SkillState {
  mastery: ToolMasteryEntry[];
  patterns: PatternAdoptionEntry[];
  antiPatterns: AntiPatternEntry[];
  quality: SessionQualityEntry[];
  summary: SkillSummary | null;
  loading: boolean;
  error: string | null;

  fetchAll: () => Promise<void>;
}

export const useSkillStore = create<SkillState>((set) => ({
  mastery: [],
  patterns: [],
  antiPatterns: [],
  quality: [],
  summary: null,
  loading: true,
  error: null,

  fetchAll: async () => {
    set({ loading: true, error: null });
    try {
      const [mastery, patterns, antiPatterns, quality, summary] = await Promise.all([
        apiFetch("/api/skills/mastery").then((r) => r.json()),
        apiFetch("/api/skills/patterns").then((r) => r.json()),
        apiFetch("/api/skills/anti-patterns").then((r) => r.json()),
        apiFetch("/api/skills/quality").then((r) => r.json()),
        apiFetch("/api/skills/summary").then((r) => r.json()),
      ]);
      set({ mastery, patterns, antiPatterns, quality, summary, loading: false });
    } catch {
      set({ error: "Failed to load skill data", loading: false });
    }
  },
}));

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    const state = useSkillStore.getState();
    data.state = Object.fromEntries(
      Object.entries(state).filter(([, v]) => typeof v !== "function")
    );
  });
  if (import.meta.hot.data.state) {
    useSkillStore.setState(import.meta.hot.data.state);
  }
}
