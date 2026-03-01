import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { VelocityTrend } from "@devscope/shared";

interface VelocityCardsProps {
  velocity: VelocityTrend;
}

function DeltaIndicator({ value }: { value: number }) {
  if (value > 0)
    return (
      <span className="flex items-center gap-0.5 text-emerald-400 text-xs">
        <TrendingUp className="h-3 w-3" />+{value}%
      </span>
    );
  if (value < 0)
    return (
      <span className="flex items-center gap-0.5 text-destructive text-xs">
        <TrendingDown className="h-3 w-3" />{value}%
      </span>
    );
  return (
    <span className="flex items-center gap-0.5 text-muted-foreground text-xs">
      <Minus className="h-3 w-3" />0%
    </span>
  );
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
        <Card key={metric.key}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">{metric.label}</p>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-2xl font-semibold">
                  {velocity.current_week[metric.key].toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  vs {velocity.previous_week[metric.key].toLocaleString()} last week
                </p>
              </div>
              <DeltaIndicator value={velocity.percent_change[metric.key]} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
