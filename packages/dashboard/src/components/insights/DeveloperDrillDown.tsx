import type {
  ActivityDataPoint,
  ToolUsageDataPoint,
  SessionStatsDataPoint,
  SessionStatsSummary,
  ProjectActivityDataPoint,
  HourlyDistributionPoint,
} from "@devscope/shared";
import { useInsightsData } from "@/hooks/useInsightsData";
import { useDateRange } from "@/hooks/useDateRange";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { ExportButton } from "@/components/ui/export-button";
import { StatCards } from "./StatCards";
import { ActivityChart } from "./charts/ActivityChart";
import { ToolUsageChart } from "./charts/ToolUsageChart";
import { SessionStatsChart } from "./charts/SessionStatsChart";
import { ProjectActivityChart } from "./charts/ProjectActivityChart";
import { HourlyHeatmap } from "./charts/HourlyHeatmap";
import { PeriodComparison } from "./PeriodComparison";
import { ArrowLeft } from "lucide-react";

interface DeveloperDrillDownProps {
  developerId: string;
  onBack: () => void;
}

export function DeveloperDrillDown({
  developerId,
  onBack,
}: DeveloperDrillDownProps) {
  const { days } = useDateRange();

  const summary = useInsightsData<SessionStatsSummary>("sessions/summary", developerId, days);
  const activity = useInsightsData<ActivityDataPoint[]>("activity", developerId, days);
  const tools = useInsightsData<ToolUsageDataPoint[]>("tools", developerId, days);
  const sessions = useInsightsData<SessionStatsDataPoint[]>("sessions", developerId, days);
  const projects = useInsightsData<ProjectActivityDataPoint[]>("projects", developerId, days);
  const hourly = useInsightsData<HourlyDistributionPoint[]>("hourly", developerId, days);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to overview
          </button>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton dataType="activity" days={days} developerId={developerId} />
          <DateRangePicker />
        </div>
      </div>

      <StatCards data={summary.data} loading={summary.loading} />

      <PeriodComparison developerId={developerId} />

      <ActivityChart data={activity.data} loading={activity.loading} />

      <div className="grid gap-6 lg:grid-cols-2">
        <SessionStatsChart data={sessions.data} loading={sessions.loading} />
        <ToolUsageChart data={tools.data} loading={tools.loading} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ProjectActivityChart data={projects.data} loading={projects.loading} />
        <HourlyHeatmap data={hourly.data} loading={hourly.loading} />
      </div>
    </div>
  );
}
