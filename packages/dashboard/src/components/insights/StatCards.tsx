import type { SessionStatsSummary } from "@devscope/shared";
import { MetricCard } from "@/components/ui/metric-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Calendar, Users, Layers } from "lucide-react";

interface StatCardsProps {
  data: SessionStatsSummary | null;
  loading: boolean;
  days?: number;
}

const BASE_STATS = [
  { key: "total_sessions" as const, label: "Total Sessions", icon: Layers, format: (_days: number) => (v: number) => v.toLocaleString() },
  { key: "avg_duration_minutes" as const, label: "Avg Duration", icon: Clock, format: (_days: number) => (v: number) => v ? `${v.toFixed(1)}m` : "—" },
  { key: "active_days" as const, label: "Active Days", icon: Calendar, format: (days: number) => (v: number) => `${v} / ${days}` },
  { key: "unique_developers" as const, label: "Developers", icon: Users, format: (_days: number) => (v: number) => v.toLocaleString() },
];

export function StatCards({ data, loading, days = 30 }: StatCardsProps) {
  const stats = BASE_STATS.map((s) => ({ ...s, format: s.format(days) }));
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {stats.map((stat) => (
        loading ? (
          <Skeleton key={stat.key} className="h-[88px] w-full rounded-xl" />
        ) : (
          <MetricCard
            key={stat.key}
            label={stat.label}
            value={data ? stat.format(data[stat.key]) : "—"}
            icon={stat.icon}
          />
        )
      ))}
    </div>
  );
}
