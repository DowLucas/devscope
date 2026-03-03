import { useEffect } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { useSkillStore } from "@/stores/skillStore";
import { SkillSummaryCards } from "./SkillSummaryCards";
import { ToolMasteryChart } from "./ToolMasteryChart";
import { PatternAdoptionChart } from "./PatternAdoptionChart";
import { AntiPatternTrendChart } from "./AntiPatternTrendChart";
import { SessionQualityChart } from "./SessionQualityChart";

export function SkillsView() {
  const { fetchAll, loading } = useSkillStore();

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Skills"
        description="Track your AI tool mastery, patterns, and session quality over time."
      />

      <SkillSummaryCards />

      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ToolMasteryChart />
          <PatternAdoptionChart />
          <AntiPatternTrendChart />
          <SessionQualityChart />
        </div>
      )}
    </div>
  );
}
