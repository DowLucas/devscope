import type { TokenUsageOverTime } from "@devscope/shared";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { ChartCard } from "../ChartCard";
import { ChartTooltip } from "./ChartTooltip";
import { CHART_COLORS, AXIS_STYLE, GRID_STYLE } from "./chartConfig";

interface TokenUsageChartProps {
  data: TokenUsageOverTime[] | null;
  loading: boolean;
}

function formatTokenAxis(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

export function TokenUsageChart({ data, loading }: TokenUsageChartProps) {
  return (
    <ChartCard title="Token Usage Over Time" loading={loading}>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data ?? []}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis
            dataKey="day"
            {...AXIS_STYLE}
            tickFormatter={(v: string) => v.slice(5)}
          />
          <YAxis {...AXIS_STYLE} tickFormatter={formatTokenAxis} />
          <Tooltip content={ChartTooltip} />
          <Legend />
          <Area
            type="monotone"
            dataKey="input_tokens"
            name="Input"
            stackId="1"
            fill={CHART_COLORS.primary}
            stroke={CHART_COLORS.primary}
            fillOpacity={0.6}
          />
          <Area
            type="monotone"
            dataKey="output_tokens"
            name="Output"
            stackId="1"
            fill={CHART_COLORS.secondary}
            stroke={CHART_COLORS.secondary}
            fillOpacity={0.6}
          />
          <Area
            type="monotone"
            dataKey="cache_read_tokens"
            name="Cache Read"
            stackId="1"
            fill={CHART_COLORS.tertiary}
            stroke={CHART_COLORS.tertiary}
            fillOpacity={0.6}
          />
          <Area
            type="monotone"
            dataKey="cache_creation_tokens"
            name="Cache Write"
            stackId="1"
            fill={CHART_COLORS.quaternary}
            stroke={CHART_COLORS.quaternary}
            fillOpacity={0.6}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
