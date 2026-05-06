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
import { useMyDeveloperIds } from "@/hooks/useMyDeveloperIds";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { ExportButton } from "@/components/ui/export-button";
import { StatCards } from "./StatCards";
import { ActivityChart } from "./charts/ActivityChart";
import { ToolUsageChart } from "./charts/ToolUsageChart";
import { SessionStatsChart } from "./charts/SessionStatsChart";
import { ProjectActivityChart } from "./charts/ProjectActivityChart";
import { HourlyHeatmap } from "./charts/HourlyHeatmap";
import { PeriodComparison } from "./PeriodComparison";
import { ArrowLeft, Lock } from "lucide-react";

interface DeveloperDrillDownProps {
  developerId: string;
  onBack: () => void;
}

export function DeveloperDrillDown({
  developerId,
  onBack,
}: DeveloperDrillDownProps) {
  const { days } = useDateRange();
  const { ids: myDeveloperIds, loading: myIdsLoading } = useMyDeveloperIds();

  // Self-only gate (DEV-31, mission constraint): per-developer breakdown is
  // visible only to the developer themselves. The backend enforces this with
  // a 403; the frontend gate avoids issuing a flurry of doomed requests and
  // gives the viewer a clear explanation instead of an error state.
  const isSelfView = myDeveloperIds.has(developerId);

  if (myIdsLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to overview
          </button>
        </div>
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!isSelfView) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to overview
          </button>
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="flex items-start gap-3">
            <Lock className="h-5 w-5 mt-0.5 text-muted-foreground" />
            <div className="space-y-1">
              <div className="font-medium text-foreground">
                Per-developer detail is self-view only
              </div>
              <p className="text-sm text-muted-foreground">
                Per-session, per-tool, and per-hour breakdowns are visible only
                to the developer themselves. DevScope is built for team
                workflow visibility, not individual surveillance — there is no
                cross-developer drill-down or leaderboard surface.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <DeveloperDrillDownDetail developerId={developerId} onBack={onBack} days={days} />;
}

interface DetailProps {
  developerId: string;
  onBack: () => void;
  days: number;
}

function DeveloperDrillDownDetail({ developerId, onBack, days }: DetailProps) {
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

      <StatCards data={summary.data} loading={summary.loading} days={days} />

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
