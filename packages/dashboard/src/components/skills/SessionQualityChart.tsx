import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "@/components/insights/ChartCard";
import { ChartTooltip } from "@/components/insights/charts/ChartTooltip";
import { CHART_COLORS, AXIS_STYLE, GRID_STYLE } from "@/components/insights/charts/chartConfig";

interface SessionQualityChartProps {
  data: {
    week: string;
    sessions: number;
    avg_success_rate: number;
    avg_tool_calls: number;
  }[];
  loading: boolean;
}

export function SessionQualityChart({ data, loading }: SessionQualityChartProps) {
  const chartData = data.map((d) => ({
    week: d.week.slice(0, 10),
    quality: Math.round(d.avg_success_rate * 100),
    sessions: d.sessions,
  }));

  return (
    <ChartCard
      title="Session Quality Trend"
      description="Average tool success rate per week"
    >
      {loading ? null : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis
              dataKey="week"
              {...AXIS_STYLE}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis
              {...AXIS_STYLE}
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip content={ChartTooltip} />
            <Line
              type="monotone"
              dataKey="quality"
              name="Quality Score"
              stroke={CHART_COLORS.primary}
              strokeWidth={2.5}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
