import type {
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
import { PageHeader } from "@/components/ui/page-header";
import { StatCards } from "./StatCards";
import { LeaderboardTable } from "./LeaderboardTable";
import { ToolUsageChart } from "./charts/ToolUsageChart";
import { ProjectActivityChart } from "./charts/ProjectActivityChart";
import { HourlyHeatmap } from "./charts/HourlyHeatmap";
import { PeriodComparison } from "./PeriodComparison";
import { DeveloperComparison } from "./DeveloperComparison";
import { ThroughputCards } from "./ThroughputCards";
import { MinuteActivityChart } from "./charts/MinuteActivityChart";

interface InsightsOverviewProps {
  onSelectDeveloper: (id: string) => void;
}

export function InsightsOverview({ onSelectDeveloper }: InsightsOverviewProps) {
  const { days } = useDateRange();

  const summary = useInsightsData<SessionStatsSummary>("sessions/summary", undefined, days);
  const leaderboard = useInsightsData<DeveloperLeaderboardEntry[]>("leaderboard", undefined, days);
  const tools = useInsightsData<ToolUsageDataPoint[]>("tools", undefined, days);
  const projects = useInsightsData<ProjectActivityDataPoint[]>("projects", undefined, days);
  const hourly = useInsightsData<HourlyDistributionPoint[]>("hourly", undefined, days);

  return (
    <div className="space-y-6">
      <PageHeader title="Insights">
        <div className="flex items-center gap-2">
          <ExportButton dataType="activity" days={days} />
          <DateRangePicker />
        </div>
      </PageHeader>

      <ThroughputCards />

      <StatCards data={summary.data} loading={summary.loading} />

      <PeriodComparison />

      <MinuteActivityChart />

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
