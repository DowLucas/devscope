import { useMemo } from "react";
import { Activity, Radio } from "lucide-react";
import { useActivityStore } from "@/stores/activityStore";
import { MetricCard } from "@/components/ui/metric-card";

export function ThroughputCards() {
  const events = useActivityStore((s) => s.events);
  const activeSessions = useActivityStore((s) => s.activeSessions);

  const eventsPerMin = useMemo(() => {
    const cutoff = Date.now() - 60_000;
    return events.filter((e) => {
      const ts = (e as unknown as Record<string, unknown>).created_at ?? (e as unknown as Record<string, unknown>).createdAt;
      return ts && new Date(ts as string).getTime() > cutoff;
    }).length;
  }, [events]);

  const activeCount = useMemo(
    () => activeSessions.filter((s) => s.status === "active").length,
    [activeSessions]
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <MetricCard
        label="Events / min"
        value={eventsPerMin}
        icon={Activity}
        status={eventsPerMin > 0 ? "green" : undefined}
      />
      <MetricCard
        label="Active Sessions"
        value={activeCount}
        icon={Radio}
        status={activeCount > 0 ? "green" : undefined}
      />
    </div>
  );
}
