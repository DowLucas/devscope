import {
  ComposedChart,
  Bar,
  Line,
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
import type { AiInsights } from "@/stores/skillStore";

interface ProductivityPoint {
  week: string;
  sessions: number;
  avg_duration_minutes: number;
  active_devs: number;
}

interface SessionProductivityChartProps {
  data: ProductivityPoint[];
  loading: boolean;
  predictions?: AiInsights["predictions"];
}

export function SessionProductivityChart({ data, loading, predictions }: SessionProductivityChartProps) {
  const sessionPrediction = predictions?.find((p) => p.metric === "sessions");

  const chartData: { week: string; sessions: number; avg_duration: number; predicted_sessions?: number }[] = data.map((d) => ({
    week: d.week.slice(0, 10),
    sessions: d.sessions,
    avg_duration: d.avg_duration_minutes,
  }));

  if (sessionPrediction) {
    for (const pw of sessionPrediction.next_weeks) {
      chartData.push({
        week: pw.week.slice(0, 10),
        sessions: 0,
        avg_duration: 0,
        predicted_sessions: pw.predicted_value,
      });
    }
  }

  return (
    <ChartCard
      title="Session Productivity"
      description="Weekly sessions (bars) and avg duration in minutes (line)"
    >
      {loading ? null : (
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis
              dataKey="week"
              {...AXIS_STYLE}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis yAxisId="left" {...AXIS_STYLE} allowDecimals={false} />
            <YAxis
              yAxisId="right"
              orientation="right"
              {...AXIS_STYLE}
              tickFormatter={(v: number) => `${v}m`}
            />
            <Tooltip content={ChartTooltip} />
            <Legend />
            <Bar
              yAxisId="left"
              dataKey="sessions"
              name="Sessions"
              fill={CHART_COLORS.primary}
              radius={[4, 4, 0, 0]}
            />
            {sessionPrediction && (
              <Bar
                yAxisId="left"
                dataKey="predicted_sessions"
                name="Predicted"
                fill={CHART_COLORS.primary}
                radius={[4, 4, 0, 0]}
                fillOpacity={0.3}
              />
            )}
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="avg_duration"
              name="Avg Duration (m)"
              stroke={CHART_COLORS.secondary}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
