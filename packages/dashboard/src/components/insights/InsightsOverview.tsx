import type {
  ActivityDataPoint,
  ToolUsageDataPoint,
  SessionStatsSummary,
  ProjectActivityDataPoint,
  DeveloperLeaderboardEntry,
  HourlyDistributionPoint,
} from "@devscope/shared";
import { useInsightsData } from "@/hooks/useInsightsData";
import { useDateRange } from "@/hooks/useDateRange";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { ExportButton } from "@/components/ui/export-button";
import { StatCards } from "./StatCards";
import { LeaderboardTable } from "./LeaderboardTable";
import { ActivityChart } from "./charts/ActivityChart";
import { ToolUsageChart } from "./charts/ToolUsageChart";
import { ProjectActivityChart } from "./charts/ProjectActivityChart";
import { HourlyHeatmap } from "./charts/HourlyHeatmap";
import { PeriodComparison } from "./PeriodComparison";
import { DeveloperComparison } from "./DeveloperComparison";

interface InsightsOverviewProps {
  onSelectDeveloper: (id: string) => void;
}

export function InsightsOverview({ onSelectDeveloper }: InsightsOverviewProps) {
  const { days } = useDateRange();

  const summary = useInsightsData<SessionStatsSummary>("sessions/summary", undefined, days);
  const activity = useInsightsData<ActivityDataPoint[]>("activity", undefined, days);
  const leaderboard = useInsightsData<DeveloperLeaderboardEntry[]>("leaderboard", undefined, days);
  const tools = useInsightsData<ToolUsageDataPoint[]>("tools", undefined, days);
  const projects = useInsightsData<ProjectActivityDataPoint[]>("projects", undefined, days);
  const hourly = useInsightsData<HourlyDistributionPoint[]>("hourly", undefined, days);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Insights</h2>
        <div className="flex items-center gap-2">
          <ExportButton dataType="activity" days={days} />
          <DateRangePicker />
        </div>
      </div>

      <StatCards data={summary.data} loading={summary.loading} />

      <PeriodComparison />

      <ActivityChart data={activity.data} loading={activity.loading} />

      <div className="grid gap-6 lg:grid-cols-2">
        <LeaderboardTable
          data={leaderboard.data}
          loading={leaderboard.loading}
          onSelect={onSelectDeveloper}
          days={days}
        />
        <ToolUsageChart data={tools.data} loading={tools.loading} />
      </div>

      <DeveloperComparison />

      <div className="grid gap-6 lg:grid-cols-2">
        <ProjectActivityChart data={projects.data} loading={projects.loading} />
        <HourlyHeatmap data={hourly.data} loading={hourly.loading} />
      </div>
    </div>
  );
}
