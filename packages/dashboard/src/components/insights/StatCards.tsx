import type { SessionStatsSummary } from "@devscope/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Calendar, Users, Layers } from "lucide-react";

interface StatCardsProps {
  data: SessionStatsSummary | null;
  loading: boolean;
}

const STATS = [
  { key: "total_sessions" as const, label: "Total Sessions", icon: Layers, format: (v: number) => v.toLocaleString() },
  { key: "avg_duration_minutes" as const, label: "Avg Duration", icon: Clock, format: (v: number) => v ? `${v.toFixed(1)}m` : "—" },
  { key: "active_days" as const, label: "Active Days", icon: Calendar, format: (v: number) => `${v} / 30` },
  { key: "unique_developers" as const, label: "Developers", icon: Users, format: (v: number) => v.toLocaleString() },
];

export function StatCards({ data, loading }: StatCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {STATS.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.key}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-accent p-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                {loading ? (
                  <Skeleton className="mt-1 h-6 w-16" />
                ) : (
                  <p className="text-lg font-semibold">
                    {data ? stat.format(data[stat.key]) : "—"}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
