import { create } from "zustand";
import { apiFetch } from "@/lib/api";

interface TeamSkill {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  trigger_phrases: string[];
  skill_body: string;
  source_pattern_ids: string[];
  source_anti_pattern_ids: string[];
  version: number;
  previous_version_id: string | null;
  generation_context: Record<string, unknown>;
  status: "draft" | "approved" | "active" | "archived";
  approved_by: string | null;
  approved_at: string | null;
  effectiveness_score: number | null;
  adoption_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface TeamSkillStats {
  total: number;
  draft: number;
  approved: number;
  active: number;
  archived: number;
  avg_effectiveness: number | null;
}

interface TeamSkillPatternLink {
  id: string;
  skill_id: string;
  pattern_id: string | null;
  anti_pattern_id: string | null;
  link_type: string;
  created_at: string;
}

interface TeamSkillDetail extends TeamSkill {
  links: TeamSkillPatternLink[];
  versions: TeamSkill[];
}

interface TeamSkillState {
  skills: TeamSkill[];
  selectedSkill: TeamSkillDetail | null;
  stats: TeamSkillStats | null;
  loading: boolean;
  generating: boolean;
  refining: string | null;
  error: string | null;
  statusFilter: string | null;

  fetchSkills: (status?: string) => Promise<void>;
  fetchSkillDetail: (id: string) => Promise<void>;
  fetchStats: () => Promise<void>;
  generateSkills: () => Promise<void>;
  refineSkill: (id: string) => Promise<void>;
  approveSkill: (id: string) => Promise<void>;
  updateSkill: (id: string, updates: Partial<TeamSkill>) => Promise<void>;
  archiveSkill: (id: string) => Promise<void>;
  exportSkill: (id: string) => Promise<string | null>;
  exportAllSkills: () => Promise<{ filename: string; content: string }[]>;
  setStatusFilter: (status: string | null) => void;
  clearSelectedSkill: () => void;
}

export type { TeamSkill, TeamSkillStats, TeamSkillDetail, TeamSkillPatternLink };

export const useTeamSkillStore = create<TeamSkillState>((set, get) => ({
  skills: [],
  selectedSkill: null,
  stats: null,
  loading: true,
  generating: false,
  refining: null,
  error: null,
  statusFilter: null,

  fetchSkills: async (status?: string) => {
    const filter = status ?? get().statusFilter;
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (filter) params.set("status", filter);
      const url = `/api/team-skills${params.toString() ? `?${params}` : ""}`;
      const res = await apiFetch(url);
      if (!res.ok) throw new Error("Failed to fetch skills");
      const skills = await res.json();
      set({ skills, loading: false });
    } catch {
      set({ error: "Failed to load team skills", loading: false });
    }
  },

  fetchSkillDetail: async (id: string) => {
    try {
      const res = await apiFetch(`/api/team-skills/${id}`);
      if (!res.ok) throw new Error("Failed to fetch skill detail");
      const data = await res.json();
      set({ selectedSkill: data });
    } catch {
      set({ error: "Failed to load skill details" });
    }
  },

  fetchStats: async () => {
    try {
      const res = await apiFetch("/api/team-skills/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      const stats = await res.json();
      set({ stats });
    } catch {
      set({ error: "Failed to load skill stats" });
    }
  },

  generateSkills: async () => {
    set({ generating: true, error: null });
    try {
      const res = await apiFetch("/api/team-skills/generate", { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to generate skills" }));
        set({ generating: false, error: (err as any).error ?? "Failed to generate skills" });
        return;
      }
      set({ generating: false });
      await Promise.all([get().fetchSkills(), get().fetchStats()]);
    } catch {
      set({ error: "Failed to generate skills", generating: false });
    }
  },

  refineSkill: async (id: string) => {
    set({ refining: id, error: null });
    try {
      const res = await apiFetch(`/api/team-skills/${id}/refine`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to refine skill" }));
        set({ refining: null, error: (err as any).error ?? "Failed to refine skill" });
        return;
      }
      set({ refining: null });
      await get().fetchSkills();
    } catch {
      set({ error: "Failed to refine skill", refining: null });
    }
  },

  approveSkill: async (id: string) => {
    set({ error: null });
    try {
      const res = await apiFetch(`/api/team-skills/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to approve skill");
      await Promise.all([get().fetchSkills(), get().fetchStats()]);
    } catch {
      set({ error: "Failed to approve skill" });
    }
  },

  updateSkill: async (id: string, updates: Partial<TeamSkill>) => {
    set({ error: null });
    try {
      const res = await apiFetch(`/api/team-skills/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update skill");
      await get().fetchSkills();
    } catch {
      set({ error: "Failed to update skill" });
    }
  },

  archiveSkill: async (id: string) => {
    set({ error: null });
    try {
      const res = await apiFetch(`/api/team-skills/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to archive skill");
      set({ selectedSkill: null });
      await Promise.all([get().fetchSkills(), get().fetchStats()]);
    } catch {
      set({ error: "Failed to archive skill" });
    }
  },

  exportSkill: async (id: string) => {
    try {
      const res = await apiFetch(`/api/team-skills/${id}/export`);
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  },

  exportAllSkills: async () => {
    try {
      const res = await apiFetch("/api/team-skills/export-all");
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  },

  setStatusFilter: (status: string | null) => {
    set({ statusFilter: status });
    get().fetchSkills(status ?? undefined);
  },

  clearSelectedSkill: () => {
    set({ selectedSkill: null });
  },
}));
