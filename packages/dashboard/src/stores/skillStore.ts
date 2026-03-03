import { create } from "zustand";
import { apiFetch } from "@/lib/api";

interface ProductivityPoint {
  week: string;
  sessions: number;
  avg_duration_minutes: number;
  active_devs: number;
}

interface OutcomePoint {
  week: string;
  total_sessions: number;
  completed_sessions: number;
  completion_rate: number;
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

interface TopPattern {
  id: string;
  name: string;
  description: string;
  effectiveness: string;
  team_match_count: number;
  avg_success_rate: number;
}

interface TopAntiPattern {
  id: string;
  name: string;
  description: string;
  detection_rule: string;
  severity: string;
  suggestion: string;
  team_match_count: number;
}

interface TeamSummary {
  total_sessions: number;
  completion_rate: number;
  avg_duration_minutes: number;
  patterns_detected: number;
  anti_patterns_detected: number;
  prev_total_sessions: number;
  prev_completion_rate: number;
  prev_avg_duration_minutes: number;
  prev_patterns_detected: number;
  prev_anti_patterns_detected: number;
}

interface CoachingData {
  anti_patterns: TopAntiPattern[];
  playbooks: { id: string; name: string; description: string; when_to_use: string }[];
}

// AI Insight types
interface Prediction {
  metric: "sessions" | "completion_rate" | "effective_patterns" | "anti_patterns";
  next_weeks: { week: string; predicted_value: number; confidence: number }[];
  trend_direction: "improving" | "stable" | "declining";
  explanation: string;
}

interface SkillAssessment {
  dimension: string;
  score: number;
  previous_score: number;
  detail: string;
}

interface CoachingCard {
  type: "strength" | "improvement" | "action";
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
  related_metric?: string;
}

interface GrowthSummary {
  overall_trend: "improving" | "stable" | "declining";
  headline: string;
  key_insight: string;
}

export interface AiInsights {
  predictions: Prediction[];
  skill_assessment: SkillAssessment[];
  coaching: CoachingCard[];
  growth_summary: GrowthSummary;
}

interface SkillState {
  summary: TeamSummary | null;
  productivity: ProductivityPoint[];
  outcomes: OutcomePoint[];
  patterns: PatternAdoptionPoint[];
  antiPatterns: AntiPatternTrendPoint[];
  topPatterns: TopPattern[];
  coaching: CoachingData | null;
  aiInsights: AiInsights | null;
  loading: boolean;
  insightsLoading: boolean;
  error: string | null;

  weeks: number;
  setWeeks: (weeks: number) => void;
  fetchAll: (weeks?: number) => Promise<void>;
  generateInsights: (weeks?: number) => Promise<void>;
}

export const useSkillStore = create<SkillState>((set, get) => ({
  summary: null,
  productivity: [],
  outcomes: [],
  patterns: [],
  antiPatterns: [],
  topPatterns: [],
  coaching: null,
  aiInsights: null,
  loading: true,
  insightsLoading: false,
  error: null,

  weeks: 12,

  setWeeks: (weeks: number) => {
    set({ weeks });
    get().fetchAll(weeks);
  },

  fetchAll: async (weeks?: number) => {
    const w = weeks ?? get().weeks;
    set({ loading: true, error: null });
    try {
      const [summary, productivity, outcomes, patterns, antiPatterns, topPatterns, coaching] =
        await Promise.all([
          apiFetch(`/api/skills/summary?weeks=${w}`).then((r) => r.json()),
          apiFetch(`/api/skills/productivity?weeks=${w}`).then((r) => r.json()),
          apiFetch(`/api/skills/outcomes?weeks=${w}`).then((r) => r.json()),
          apiFetch(`/api/skills/patterns?weeks=${w}`).then((r) => r.json()),
          apiFetch(`/api/skills/anti-patterns?weeks=${w}`).then((r) => r.json()),
          apiFetch(`/api/skills/top-patterns?weeks=${w}`).then((r) => r.json()),
          apiFetch(`/api/skills/coaching?weeks=${w}`).then((r) => r.json()),
        ]);
      set({
        summary,
        productivity,
        outcomes,
        patterns,
        antiPatterns,
        topPatterns,
        coaching,
        loading: false,
      });
    } catch {
      set({ error: "Failed to load team skills data", loading: false });
    }
  },

  generateInsights: async (weeks?: number) => {
    const w = weeks ?? get().weeks;
    set({ insightsLoading: true });
    try {
      const res = await apiFetch(`/api/skills/insights?weeks=${w}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to generate insights" }));
        set({ insightsLoading: false, error: (err as any).error ?? "Failed to generate insights" });
        return;
      }
      const data = await res.json();
      set({ aiInsights: data as AiInsights, insightsLoading: false });
    } catch {
      set({ error: "Failed to generate insights", insightsLoading: false });
    }
  },
}));
