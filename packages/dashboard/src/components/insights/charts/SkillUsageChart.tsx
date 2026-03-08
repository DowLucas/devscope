import type { SkillUsageDataPoint } from "@devscope/shared";
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

interface SkillUsageChartProps {
  data: SkillUsageDataPoint[] | null;
  loading: boolean;
}

export function SkillUsageChart({ data, loading }: SkillUsageChartProps) {
  return (
    <ChartCard title="Skill Usage" loading={loading}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data ?? []} layout="vertical">
          <CartesianGrid {...GRID_STYLE} />
          <XAxis type="number" {...AXIS_STYLE} />
          <YAxis
            dataKey="skill_name"
            type="category"
            {...AXIS_STYLE}
            width={140}
            tickFormatter={(v: string) =>
              v.length > 20 ? v.slice(0, 18) + "..." : v
            }
          />
          <Tooltip content={ChartTooltip} />
          <Bar
            dataKey="success_count"
            name="Success"
            stackId="a"
            fill={CHART_COLORS.secondary}
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="fail_count"
            name="Fail"
            stackId="a"
            fill={CHART_COLORS.destructive}
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
