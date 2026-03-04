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
import { ChartCard } from "@/components/insights/ChartCard";
import { ChartTooltip } from "@/components/insights/charts/ChartTooltip";
import { CHART_COLORS, AXIS_STYLE, GRID_STYLE } from "@/components/insights/charts/chartConfig";

interface PatternAdoptionChartProps {
  data: {
    week: string;
    effective_count: number;
    ineffective_count: number;
    neutral_count: number;
  }[];
  loading: boolean;
}

export function PatternAdoptionChart({ data, loading }: PatternAdoptionChartProps) {
  const chartData = data.map((d) => ({
    ...d,
    week: d.week.slice(0, 10),
  }));

  return (
    <ChartCard
      title="Strategy Adoption"
      description="Effective vs ineffective developer strategies by week"
    >
      {loading ? null : (
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis
              dataKey="week"
              {...AXIS_STYLE}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={ChartTooltip} />
            <Legend />
            <Area
              type="monotone"
              dataKey="effective_count"
              name="Effective"
              stackId="1"
              fill={CHART_COLORS.secondary}
              stroke={CHART_COLORS.secondary}
              fillOpacity={0.6}
            />
            <Area
              type="monotone"
              dataKey="neutral_count"
              name="Neutral"
              stackId="1"
              fill={CHART_COLORS.tertiary}
              stroke={CHART_COLORS.tertiary}
              fillOpacity={0.4}
            />
            <Area
              type="monotone"
              dataKey="ineffective_count"
              name="Ineffective"
              stackId="1"
              fill={CHART_COLORS.destructive}
              stroke={CHART_COLORS.destructive}
              fillOpacity={0.6}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
