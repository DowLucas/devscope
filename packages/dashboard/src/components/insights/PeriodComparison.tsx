import { MetricCard } from "@/components/ui/metric-card";
import type { PeriodComparisonResult } from "@devscope/shared";
import { useInsightsData } from "@/hooks/useInsightsData";
import { useDateRange } from "@/hooks/useDateRange";
import { ChartCard } from "./ChartCard";

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
          <MetricCard
            key={metric.key}
            label={metric.label}
            value={data?.current[metric.key]?.toLocaleString() ?? "—"}
            previousValue={data?.previous[metric.key]?.toLocaleString() ?? "—"}
            delta={data?.deltas[metric.key]}
          />
        ))}
      </div>
    </ChartCard>
  );
}
