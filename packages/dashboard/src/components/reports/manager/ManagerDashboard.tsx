import { useManagerSummary } from "@/hooks/useManagerSummary";
import { Skeleton } from "@/components/ui/skeleton";
import { TeamSummaryCards } from "./TeamSummaryCards";
import { BurnoutRiskTable } from "./BurnoutRiskTable";
import { StuckSessionAlerts } from "@/components/health/StuckSessionAlerts";
import { FailureClustersTable } from "@/components/failures/FailureClustersTable";

export function ManagerDashboard() {
  const { data, loading } = useManagerSummary(7);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-muted-foreground text-center py-12 text-sm">
        Unable to load manager summary.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TeamSummaryCards
        sessions={data.velocity.sessions}
        prompts={data.velocity.prompts}
        tool_calls={data.velocity.tool_calls}
      />

      <BurnoutRiskTable data={data.burnout_risks} />

      <div className="grid gap-6 lg:grid-cols-2">
        <StuckSessionAlerts sessions={data.stuck_sessions} loading={false} />
        <FailureClustersTable
          data={data.failure_clusters.map((c) => ({
            ...c,
            error_messages: [],
          }))}
          loading={false}
        />
      </div>
    </div>
  );
}
