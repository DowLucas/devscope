import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { TrafficLight } from "@/components/ui/traffic-light";
import type { KpiMetric } from "@devscope/shared";

interface TeamSummaryCardsProps {
  sessions: KpiMetric;
  prompts: KpiMetric;
  tool_calls: KpiMetric;
}

function DeltaArrow({ delta, trend }: { delta: number; trend: string }) {
  if (trend === "up")
    return (
      <span className="flex items-center gap-0.5 text-emerald-400 text-xs">
        <TrendingUp className="h-3 w-3" />+{delta}%
      </span>
    );
  if (trend === "down")
    return (
      <span className="flex items-center gap-0.5 text-destructive text-xs">
        <TrendingDown className="h-3 w-3" />{delta}%
      </span>
    );
  return (
    <span className="flex items-center gap-0.5 text-muted-foreground text-xs">
      <Minus className="h-3 w-3" />0%
    </span>
  );
}

function KpiCard({ kpi }: { kpi: KpiMetric }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-muted-foreground">{kpi.label}</p>
          <TrafficLight status={kpi.status} size="md" />
        </div>
        <p className="text-2xl font-semibold">{kpi.value.toLocaleString()}</p>
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs text-muted-foreground">
            vs {kpi.previous_value.toLocaleString()} prev
          </p>
          <DeltaArrow delta={kpi.delta_percent} trend={kpi.trend} />
        </div>
      </CardContent>
    </Card>
  );
}

export function TeamSummaryCards({ sessions, prompts, tool_calls }: TeamSummaryCardsProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <KpiCard kpi={sessions} />
      <KpiCard kpi={prompts} />
      <KpiCard kpi={tool_calls} />
    </div>
  );
}
