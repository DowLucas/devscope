import { MetricCard } from "@/components/ui/metric-card";
import type { VelocityTrend } from "@devscope/shared";

interface VelocityCardsProps {
  velocity: VelocityTrend;
}

const METRICS = [
  { key: "sessions" as const, label: "Sessions" },
  { key: "prompts" as const, label: "Prompts" },
  { key: "tool_calls" as const, label: "Tool Calls" },
];

export function VelocityCards({ velocity }: VelocityCardsProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {METRICS.map((metric) => (
        <MetricCard
          key={metric.key}
          label={metric.label}
          value={velocity.current_week[metric.key].toLocaleString()}
          previousValue={`${velocity.previous_week[metric.key].toLocaleString()} last week`}
          delta={velocity.percent_change[metric.key]}
        />
      ))}
    </div>
  );
}
