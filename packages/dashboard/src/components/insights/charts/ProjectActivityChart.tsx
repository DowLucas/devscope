import type { ProjectActivityDataPoint } from "@devscope/shared";
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

interface ProjectActivityChartProps {
  data: ProjectActivityDataPoint[] | null;
  loading: boolean;
}

export function ProjectActivityChart({
  data,
  loading,
}: ProjectActivityChartProps) {
  return (
    <ChartCard title="Project Activity" loading={loading}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data ?? []} layout="vertical">
          <CartesianGrid {...GRID_STYLE} />
          <XAxis type="number" {...AXIS_STYLE} />
          <YAxis
            dataKey="project_name"
            type="category"
            {...AXIS_STYLE}
            width={120}
            tickFormatter={(v: string) =>
              v.length > 16 ? v.slice(0, 14) + "..." : v
            }
          />
          <Tooltip content={ChartTooltip} />
          <Bar
            dataKey="total_minutes"
            name="Minutes"
            fill={CHART_COLORS.quaternary}
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
