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
import { AXIS_STYLE, GRID_STYLE } from "@/components/insights/charts/chartConfig";

const TOOL_COLORS = [
  "oklch(0.488 0.243 264.376)",
  "oklch(0.696 0.17 162.48)",
  "oklch(0.769 0.188 70.08)",
  "oklch(0.627 0.265 303.9)",
  "oklch(0.645 0.246 16.439)",
  "oklch(0.5 0.2 200)",
  "oklch(0.6 0.15 100)",
  "oklch(0.7 0.2 50)",
];

interface ToolMasteryChartProps {
  data: { week: string; tool_name: string; success_rate: number; total: number }[];
  loading: boolean;
}

export function ToolMasteryChart({ data, loading }: ToolMasteryChartProps) {
  // Pivot: group by week, one line per tool
  const toolNames = [...new Set(data.map((d) => d.tool_name))].slice(0, 8);
  const weekMap = new Map<string, Record<string, string | number>>();

  for (const row of data) {
    if (!toolNames.includes(row.tool_name)) continue;
    const week = row.week.slice(0, 10);
    if (!weekMap.has(week)) weekMap.set(week, { week });
    weekMap.get(week)![row.tool_name] = Math.round(row.success_rate * 100);
  }

  const chartData = Array.from(weekMap.values()).sort((a, b) =>
    a.week < b.week ? -1 : 1
  );

  return (
    <ChartCard
      title="Tool Mastery Over Time"
      description="Success rate per tool by week"
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
            {toolNames.map((tool, i) => (
              <Line
                key={tool}
                type="monotone"
                dataKey={tool}
                name={tool}
                stroke={TOOL_COLORS[i % TOOL_COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
