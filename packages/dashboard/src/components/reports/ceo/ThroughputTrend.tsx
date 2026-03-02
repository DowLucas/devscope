import { useEffect, useState } from "react";
import type { ActivityDataPoint } from "@devscope/shared";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "@/components/insights/ChartCard";
import { ChartTooltip } from "@/components/insights/charts/ChartTooltip";
import { CHART_COLORS, AXIS_STYLE, GRID_STYLE } from "@/components/insights/charts/chartConfig";
import { apiFetch } from "@/lib/api";

export function ThroughputTrend() {
  const [data, setData] = useState<ActivityDataPoint[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiFetch("/api/insights/activity?days=90")
      .then((r) => r.json())
      .then((d) => {
        if (active) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return (
    <ChartCard title="Session Throughput (90 days)" loading={loading}>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data ?? []}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis
            dataKey="day"
            {...AXIS_STYLE}
            tickFormatter={(v: string) => v.slice(5)}
          />
          <YAxis {...AXIS_STYLE} />
          <Tooltip content={ChartTooltip} />
          <Area
            type="monotone"
            dataKey="sessions"
            name="Sessions"
            fill={CHART_COLORS.primary}
            stroke={CHART_COLORS.primary}
            fillOpacity={0.4}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
