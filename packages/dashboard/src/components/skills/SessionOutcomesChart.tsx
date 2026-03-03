import {
  LineChart,
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

interface OutcomePoint {
  week: string;
  total_sessions: number;
  completed_sessions: number;
  completion_rate: number;
}

interface SessionOutcomesChartProps {
  data: OutcomePoint[];
  loading: boolean;
  predictions?: AiInsights["predictions"];
}

export function SessionOutcomesChart({ data, loading, predictions }: SessionOutcomesChartProps) {
  const completionPrediction = predictions?.find((p) => p.metric === "completion_rate");

  const chartData = data.map((d) => ({
    week: d.week.slice(0, 10),
    completion_rate: Math.round(d.completion_rate * 100),
  }));

  if (completionPrediction) {
    for (const pw of completionPrediction.next_weeks) {
      chartData.push({
        week: pw.week.slice(0, 10),
        completion_rate: 0,
        predicted_rate: Math.round(pw.predicted_value * 100),
      } as any);
    }
  }

  return (
    <ChartCard
      title="Session Outcomes"
      description="Weekly completion rate"
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
            <Legend />
            <Line
              type="monotone"
              dataKey="completion_rate"
              name="Completion Rate"
              stroke={CHART_COLORS.primary}
              strokeWidth={2.5}
              dot={{ r: 3 }}
            />
            {completionPrediction && (
              <Line
                type="monotone"
                dataKey="predicted_rate"
                name="Predicted"
                stroke={CHART_COLORS.primary}
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={{ r: 3 }}
                opacity={0.5}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
