import type { SessionStatsDataPoint } from "@devscope/shared";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "../ChartCard";
import { ChartTooltip } from "./ChartTooltip";
import { CHART_COLORS, AXIS_STYLE, GRID_STYLE } from "./chartConfig";

interface SessionStatsChartProps {
  data: SessionStatsDataPoint[] | null;
  loading: boolean;
}

export function SessionStatsChart({ data, loading }: SessionStatsChartProps) {
  return (
    <ChartCard title="Session Stats" loading={loading}>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data ?? []}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis
            dataKey="day"
            {...AXIS_STYLE}
            tickFormatter={(v: string) => v.slice(5)}
          />
          <YAxis yAxisId="left" {...AXIS_STYLE} />
          <YAxis yAxisId="right" orientation="right" {...AXIS_STYLE} />
          <Tooltip content={ChartTooltip} />
          <Bar
            yAxisId="left"
            dataKey="session_count"
            name="Sessions"
            fill={CHART_COLORS.primary}
            radius={[4, 4, 0, 0]}
            fillOpacity={0.8}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="avg_duration_minutes"
            name="Avg Duration (min)"
            stroke={CHART_COLORS.tertiary}
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
