import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DeltaIndicator } from "@/components/ui/delta-indicator";
import { TrafficLight } from "@/components/ui/traffic-light";

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  previousValue?: string | number;
  delta?: number;
  status?: "green" | "yellow" | "red";
  format?: (v: number) => string;
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  previousValue,
  delta,
  status,
  format,
}: MetricCardProps) {
  const displayValue =
    format && typeof value === "number" ? format(value) : value;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          {status && <TrafficLight status={status} />}
        </div>

        <div className="mt-2 flex items-center gap-3">
          {Icon && (
            <div className="rounded-lg bg-primary/10 p-2">
              <Icon className="h-4 w-4 text-primary" />
            </div>
          )}
          <span className="text-2xl font-bold tabular-nums">
            {displayValue}
          </span>
        </div>

        {(previousValue !== undefined || delta !== undefined) && (
          <div className="mt-2 flex items-center justify-between">
            {previousValue !== undefined ? (
              <span className="text-xs text-muted-foreground">
                vs {previousValue}
              </span>
            ) : (
              <span />
            )}
            {delta !== undefined && <DeltaIndicator value={delta} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
