import { useRoiMetrics } from "@/hooks/useRoiMetrics";
import { Skeleton } from "@/components/ui/skeleton";
import { ScorecardKpis } from "./ScorecardKpis";
import { ProjectAllocationChart } from "./ProjectAllocationChart";
import { RoiMetricsPanel } from "./RoiMetricsPanel";

export function CtoDashboard() {
  const { data, loading } = useRoiMetrics(7);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[300px] w-full" />
          <Skeleton className="h-[300px] w-full" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-muted-foreground text-center py-12 text-sm">
        Unable to load ROI metrics.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ScorecardKpis kpis={data.kpis} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ProjectAllocationChart data={data.project_allocation} />
        <RoiMetricsPanel
          prompts_per_session={data.prompts_per_session}
          tool_calls_per_session={data.tool_calls_per_session}
          sessions_per_developer={data.sessions_per_developer}
          active_days_per_developer={data.active_days_per_developer}
          total_sessions={data.total_sessions}
          total_developers={data.total_developers}
        />
      </div>
    </div>
  );
}
