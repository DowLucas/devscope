import { useScorecard } from "@/hooks/useScorecard";
import { Skeleton } from "@/components/ui/skeleton";
import { ExecutiveKpis } from "./ExecutiveKpis";
import { ThroughputTrend } from "./ThroughputTrend";

export function CeoDashboard() {
  const { data, loading } = useScorecard(7);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-muted-foreground text-center py-12 text-sm">
        Unable to load executive scorecard.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ExecutiveKpis kpis={data.kpis} />
      <ThroughputTrend />
    </div>
  );
}
