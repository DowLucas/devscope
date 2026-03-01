import type { HourlyDistributionPoint } from "@devscope/shared";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "../ChartCard";
import { ChartTooltip } from "./ChartTooltip";
import { CHART_COLORS, AXIS_STYLE, GRID_STYLE } from "./chartConfig";

interface HourlyHeatmapProps {
  data: HourlyDistributionPoint[] | null;
  loading: boolean;
}

function fillHours(data: HourlyDistributionPoint[] | null): HourlyDistributionPoint[] {
  const map = new Map((data ?? []).map((d) => [d.hour, d.event_count]));
  return Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    event_count: map.get(i) ?? 0,
  }));
}

export function HourlyHeatmap({ data, loading }: HourlyHeatmapProps) {
  return (
    <ChartCard title="Activity by Hour" loading={loading}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={fillHours(data)}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis
            dataKey="hour"
            {...AXIS_STYLE}
            tickFormatter={(v: number) => `${v}:00`}
          />
          <YAxis {...AXIS_STYLE} />
          <Tooltip
            content={ChartTooltip}
            labelFormatter={(v) => `${v}:00`}
          />
          <Bar
            dataKey="event_count"
            name="Events"
            fill={CHART_COLORS.primary}
            radius={[4, 4, 0, 0]}
            fillOpacity={0.8}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
