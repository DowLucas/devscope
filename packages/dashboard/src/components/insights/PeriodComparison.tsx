import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { PeriodComparisonResult } from "@devscope/shared";
import { useInsightsData } from "@/hooks/useInsightsData";
import { useDateRange } from "@/hooks/useDateRange";
import { ChartCard } from "./ChartCard";

function DeltaIndicator({ value }: { value: number }) {
  if (value > 0)
    return (
      <span className="flex items-center gap-0.5 text-emerald-400 text-xs font-medium">
        <TrendingUp className="h-3 w-3" />+{value}%
      </span>
    );
  if (value < 0)
    return (
      <span className="flex items-center gap-0.5 text-destructive text-xs font-medium">
        <TrendingDown className="h-3 w-3" />{value}%
      </span>
    );
  return (
    <span className="flex items-center gap-0.5 text-muted-foreground text-xs font-medium">
      <Minus className="h-3 w-3" />0%
    </span>
  );
}

const METRICS = [
  { key: "sessions" as const, label: "Sessions" },
  { key: "prompts" as const, label: "Prompts" },
  { key: "tool_calls" as const, label: "Tool Calls" },
  { key: "failures" as const, label: "Failures" },
  { key: "active_developers" as const, label: "Developers" },
];

interface PeriodComparisonProps {
  developerId?: string;
}

export function PeriodComparison({ developerId }: PeriodComparisonProps) {
  const { days } = useDateRange();
  const { data, loading } = useInsightsData<PeriodComparisonResult>(
    "period-comparison",
    developerId,
    days
  );

  return (
    <ChartCard title={`Period Comparison (${days}d vs previous ${days}d)`} loading={loading}>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {METRICS.map((metric) => (
          <Card key={metric.key} className="bg-muted/30">
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground mb-1">{metric.label}</p>
              <p className="text-lg font-semibold">
                {data?.current[metric.key]?.toLocaleString() ?? "—"}
              </p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-muted-foreground">
                  was {data?.previous[metric.key]?.toLocaleString() ?? "—"}
                </span>
                {data && <DeltaIndicator value={data.deltas[metric.key]} />}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ChartCard>
  );
}
