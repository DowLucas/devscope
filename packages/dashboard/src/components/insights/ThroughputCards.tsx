import { useEffect, useMemo, useState } from "react";
import { Activity, Radio } from "lucide-react";
import { useActivityStore } from "@/stores/activityStore";
import { MetricCard } from "@/components/ui/metric-card";

export function ThroughputCards() {
  const events = useActivityStore((s) => s.events);
  const activeSessions = useActivityStore((s) => s.activeSessions);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const eventsPerMin = useMemo(() => {
    const cutoff = now - 60_000;
    return events.filter((e) => {
      return e.timestamp && new Date(e.timestamp).getTime() > cutoff;
    }).length;
  }, [events, now]);

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
