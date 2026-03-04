import { useEffect } from "react";
import { useTeamSkillStore } from "@/stores/teamSkillStore";
import { TeamSkillCard } from "./TeamSkillCard";
import { TeamSkillDetail } from "./TeamSkillDetail";
import { GenerateSkillsButton } from "./GenerateSkillsButton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, BookOpen, CheckCircle, Zap, Archive } from "lucide-react";

const STATUS_FILTERS = [
  { label: "All", value: null },
  { label: "Draft", value: "draft" },
  { label: "Approved", value: "approved" },
  { label: "Active", value: "active" },
  { label: "Archived", value: "archived" },
] as const;

export function TeamSkillsSection() {
  const {
    skills,
    selectedSkill,
    stats,
    loading,
    error,
    statusFilter,
    fetchSkills,
    fetchStats,
    fetchSkillDetail,
    setStatusFilter,
    clearSelectedSkill,
  } = useTeamSkillStore();

  useEffect(() => {
    fetchSkills();
    fetchStats();
  }, [fetchSkills, fetchStats]);

  return (
    <div className="space-y-6">
      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="flex items-center gap-3 pt-0">
              <div className="rounded-md bg-primary/10 p-2">
                <BookOpen className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total Skills</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-0">
              <div className="rounded-md bg-amber-500/10 p-2">
                <CheckCircle className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.draft}</p>
                <p className="text-xs text-muted-foreground">Drafts</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-0">
              <div className="rounded-md bg-green-500/10 p-2">
                <Zap className="h-4 w-4 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.active}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-0">
              <div className="rounded-md bg-muted p-2">
                <Archive className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {stats.avg_effectiveness !== null
                    ? `${Math.round(stats.avg_effectiveness * 100)}%`
                    : "--"}
                </p>
                <p className="text-xs text-muted-foreground">Avg Effectiveness</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Action row: Generate button + status filter tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <GenerateSkillsButton />

        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => setStatusFilter(f.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                statusFilter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && skills.length === 0 && (
        <div className="text-center py-12 space-y-3">
          <BookOpen className="h-10 w-10 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No workflow skills yet. Generate skills from your team's proven Claude Code strategies.
          </p>
          <GenerateSkillsButton />
        </div>
      )}

      {/* Skills grid */}
      {!loading && skills.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {skills.map((skill) => (
            <TeamSkillCard
              key={skill.id}
              skill={skill}
              onSelect={(id) => fetchSkillDetail(id)}
            />
          ))}
        </div>
      )}

      {/* Detail modal */}
      <Dialog
        open={!!selectedSkill}
        onOpenChange={(open) => {
          if (!open) clearSelectedSkill();
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogTitle className="sr-only">
            {selectedSkill?.name ?? "Skill Detail"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Details and actions for the selected skill
          </DialogDescription>
          <TeamSkillDetail />
        </DialogContent>
      </Dialog>
    </div>
  );
}
