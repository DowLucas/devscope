import { MetricCard } from "@/components/ui/metric-card";
import type { KpiMetric } from "@devscope/shared";

interface ScorecardKpisProps {
  kpis: KpiMetric[];
}

export function ScorecardKpis({ kpis }: ScorecardKpisProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {kpis.map((kpi) => (
        <MetricCard
          key={kpi.label}
          label={kpi.label}
          value={kpi.value.toLocaleString()}
          previousValue={kpi.previous_value.toLocaleString()}
          delta={kpi.delta_percent}
          status={kpi.status}
        />
      ))}
    </div>
  );
}
