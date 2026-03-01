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
import { ChartCard } from "../ChartCard";
import { ChartTooltip } from "./ChartTooltip";
import { CHART_COLORS, AXIS_STYLE, GRID_STYLE } from "./chartConfig";

interface ActivityChartProps {
  data: ActivityDataPoint[] | null;
  loading: boolean;
}

export function ActivityChart({ data, loading }: ActivityChartProps) {
  return (
    <ChartCard title="Activity Over Time" loading={loading}>
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
            dataKey="prompts"
            name="Prompts"
            stackId="1"
            fill={CHART_COLORS.primary}
            stroke={CHART_COLORS.primary}
            fillOpacity={0.6}
          />
          <Area
            type="monotone"
            dataKey="tool_calls"
            name="Tool Calls"
            stackId="1"
            fill={CHART_COLORS.secondary}
            stroke={CHART_COLORS.secondary}
            fillOpacity={0.6}
          />
          <Area
            type="monotone"
            dataKey="sessions"
            name="Sessions"
            stackId="1"
            fill={CHART_COLORS.tertiary}
            stroke={CHART_COLORS.tertiary}
            fillOpacity={0.6}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
