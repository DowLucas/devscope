import { useEffect, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { useSkillStore } from "@/stores/skillStore";
import { TeamSummaryCards } from "./TeamSummaryCards";
import { WeekSelector } from "./WeekSelector";
import { SessionProductivityChart } from "./SessionProductivityChart";
import { SessionOutcomesChart } from "./SessionOutcomesChart";
import { PatternAdoptionChart } from "./PatternAdoptionChart";
import { AntiPatternTrendChart } from "./AntiPatternTrendChart";
import { SkillRadarChart } from "./SkillRadarChart";
import { GrowthSummaryBanner } from "./GrowthSummaryBanner";
import { CoachingSection } from "./CoachingSection";
import { TeamSkillsSection } from "../team-skills/TeamSkillsSection";
import { TeamTopologyTab } from "@/components/topology/TeamTopologyTab";

export function SkillsView() {
  const {
    summary,
    productivity,
    outcomes,
    patterns,
    antiPatterns,
    topPatterns,
    coaching,
    aiInsights,
    loading,
    insightsLoading,
    error,
    weeks,
    setWeeks,
    fetchAll,
    generateInsights,
  } = useSkillStore();

  const [activeTab, setActiveTab] = useState<"overview" | "ai-skills" | "topology">("overview");

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const hasPatternData = patterns.length > 0 || antiPatterns.length > 0;

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab("overview")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "overview"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab("ai-skills")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "ai-skills"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Skills
        </button>
        <button
          onClick={() => setActiveTab("topology")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "topology"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Topology
        </button>
      </div>

      {activeTab === "overview" ? (
        <div className="space-y-6">
          <PageHeader
            title="Claude Code Skills"
            description="How your team uses Claude Code — usage patterns, proficiency metrics, and tips for improvement"
          >
            <WeekSelector value={weeks} onChange={setWeeks} />
          </PageHeader>

          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Section 1: Summary Cards (always visible) */}
          <TeamSummaryCards summary={summary} loading={loading} />

          {/* Section 2: Growth Charts (always visible) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SessionProductivityChart
              data={productivity}
              loading={loading}
              predictions={aiInsights?.predictions}
            />
            <SessionOutcomesChart
              data={outcomes}
              loading={loading}
              predictions={aiInsights?.predictions}
            />
          </div>

          {/* Pattern charts (progressive — shown when data exists) */}
          {hasPatternData && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <PatternAdoptionChart data={patterns} loading={loading} />
              <AntiPatternTrendChart data={antiPatterns} loading={loading} />
            </div>
          )}

          {/* Section 3: AI Growth Insights (progressive, behind button) */}
          <div className="space-y-4">
            {!aiInsights && (
              <button
                onClick={() => generateInsights()}
                disabled={insightsLoading}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {insightsLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating Insights...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Insights
                  </>
                )}
              </button>
            )}

            {aiInsights && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold">Claude Code Proficiency</h2>
                <GrowthSummaryBanner data={aiInsights.growth_summary} />
                {aiInsights.skill_assessment.length > 0 && (
                  <SkillRadarChart data={aiInsights.skill_assessment} />
                )}
              </div>
            )}
          </div>

          {/* Section 4: Coaching (progressive) */}
          <CoachingSection
            topPatterns={topPatterns}
            coaching={coaching}
            aiCoaching={aiInsights?.coaching}
            loading={loading}
          />
        </div>
      ) : activeTab === "topology" ? (
        <TeamTopologyTab />
      ) : (
        <TeamSkillsSection />
      )}
    </div>
  );
}
