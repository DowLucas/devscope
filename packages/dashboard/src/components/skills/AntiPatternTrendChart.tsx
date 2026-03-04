import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "@/components/insights/ChartCard";
import { ChartTooltip } from "@/components/insights/charts/ChartTooltip";
import { CHART_COLORS, AXIS_STYLE, GRID_STYLE } from "@/components/insights/charts/chartConfig";

interface AntiPatternTrendChartProps {
  data: {
    week: string;
    count: number;
    by_rule: Record<string, number>;
  }[];
  loading: boolean;
}

export function AntiPatternTrendChart({ data, loading }: AntiPatternTrendChartProps) {
  const chartData = data.map((d) => ({
    week: d.week.slice(0, 10),
    count: d.count,
    ...d.by_rule,
  }));

  return (
    <ChartCard
      title="Usage Issues"
      description="Weekly usage issues detected (lower is better)"
    >
      {loading ? null : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis
              dataKey="week"
              {...AXIS_STYLE}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis {...AXIS_STYLE} allowDecimals={false} />
            <Tooltip content={ChartTooltip} />
            <Bar
              dataKey="count"
              name="Issues"
              fill={CHART_COLORS.destructive}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
