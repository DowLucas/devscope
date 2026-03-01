import type { WorkloadEntry } from "@devscope/shared";
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

interface WorkloadChartProps {
  data: WorkloadEntry[];
  loading: boolean;
}

export function WorkloadChart({ data, loading }: WorkloadChartProps) {
  return (
    <ChartCard title="Today's Workload Distribution" loading={loading}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid {...GRID_STYLE} />
          <XAxis type="number" {...AXIS_STYLE} />
          <YAxis
            dataKey="developer_name"
            type="category"
            {...AXIS_STYLE}
            width={100}
            tickFormatter={(v: string) =>
              v.length > 14 ? v.slice(0, 12) + "..." : v
            }
          />
          <Tooltip content={ChartTooltip} />
          <Bar
            dataKey="prompts"
            name="Prompts"
            stackId="a"
            fill={CHART_COLORS.primary}
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="tool_calls"
            name="Tool Calls"
            stackId="a"
            fill={CHART_COLORS.secondary}
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
