import { useTeamHealth } from "@/hooks/useTeamHealth";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { DeveloperHeatmap } from "./DeveloperHeatmap";
import { WorkloadChart } from "./WorkloadChart";
import { VelocityCards } from "./VelocityCards";
import { SessionsNeedingAttention } from "./SessionsNeedingAttention";

export function HealthView() {
  const { data, loading } = useTeamHealth();

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Team Health" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-muted-foreground text-center py-12 text-sm">
        Unable to load team health data.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Team Health" />

      <VelocityCards velocity={data.velocity} />

      <DeveloperHeatmap developers={data.developers} />

      <div className="grid gap-6 lg:grid-cols-2">
        <WorkloadChart data={data.workload} loading={false} />
        <SessionsNeedingAttention sessions={data.sessionsNeedingAttention} loading={false} />
      </div>
    </div>
  );
}
