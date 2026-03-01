import type { ToolFailureRatePoint } from "@devscope/shared";
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

interface FailureRateChartProps {
  data: ToolFailureRatePoint[] | null;
  loading: boolean;
}

export function FailureRateChart({ data, loading }: FailureRateChartProps) {
  // Aggregate by day
  const byDay = new Map<string, { day: string; failures: number; successes: number; rate: number }>();
  for (const point of data ?? []) {
    const existing = byDay.get(point.day) ?? { day: point.day, failures: 0, successes: 0, rate: 0 };
    existing.failures += point.fail_count;
    existing.successes += point.success_count;
    byDay.set(point.day, existing);
  }
  const chartData = Array.from(byDay.values()).map((d) => ({
    ...d,
    rate: d.failures + d.successes > 0
      ? Math.round((d.failures / (d.failures + d.successes)) * 100)
      : 0,
  }));

  return (
    <ChartCard title="Failure Rate Over Time" loading={loading}>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis
            dataKey="day"
            {...AXIS_STYLE}
            tickFormatter={(v: string) => v.slice(5)}
          />
          <YAxis {...AXIS_STYLE} unit="%" />
          <Tooltip content={ChartTooltip} />
          <Area
            type="monotone"
            dataKey="rate"
            name="Failure Rate %"
            fill={CHART_COLORS.destructive}
            stroke={CHART_COLORS.destructive}
            fillOpacity={0.3}
          />
          <Area
            type="monotone"
            dataKey="failures"
            name="Failures"
            fill={CHART_COLORS.quaternary}
            stroke={CHART_COLORS.quaternary}
            fillOpacity={0.2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
