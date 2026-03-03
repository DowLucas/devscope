import { useEffect } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { useSkillStore } from "@/stores/skillStore";
import { SkillSummaryCards } from "./SkillSummaryCards";
import { ToolMasteryChart } from "./ToolMasteryChart";
import { PatternAdoptionChart } from "./PatternAdoptionChart";
import { AntiPatternTrendChart } from "./AntiPatternTrendChart";
import { SessionQualityChart } from "./SessionQualityChart";

export function SkillsView() {
  const { mastery, patterns, antiPatterns, quality, summary, loading, error, fetchAll } =
    useSkillStore();

  useEffect(() => {
    fetchAll(12);
  }, [fetchAll]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Skills"
        description="Track your AI development skills and patterns over time"
      />

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <SkillSummaryCards summary={summary} loading={loading} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ToolMasteryChart data={mastery} loading={loading} />
        <SessionQualityChart data={quality} loading={loading} />
        <PatternAdoptionChart data={patterns} loading={loading} />
        <AntiPatternTrendChart data={antiPatterns} loading={loading} />
      </div>
    </div>
  );
}
