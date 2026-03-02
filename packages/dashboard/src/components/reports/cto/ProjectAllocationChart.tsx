import type { ProjectAllocation } from "@devscope/shared";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { ChartCard } from "@/components/insights/ChartCard";
import { CHART_COLORS } from "@/components/insights/charts/chartConfig";

interface ProjectAllocationChartProps {
  data: ProjectAllocation[];
}

const COLORS = [
  CHART_COLORS.primary,
  CHART_COLORS.secondary,
  CHART_COLORS.tertiary,
  CHART_COLORS.quaternary,
  CHART_COLORS.destructive,
];

export function ProjectAllocationChart({ data }: ProjectAllocationChartProps) {
  if (data.length === 0) {
    return (
      <ChartCard title="Project Allocation">
        <div className="text-muted-foreground text-center py-12 text-sm">
          No project data available.
        </div>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Project Allocation">
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={data}
            dataKey="percentage"
            nameKey="project_name"
            cx="50%"
            cy="50%"
            outerRadius={100}
            label={({ name, value, x, y }: { name?: string; value?: number; x?: number; y?: number }) => (
              <text
                x={x}
                y={y}
                fill="oklch(0.708 0 0)"
                fontSize={12}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {`${name ?? ""} (${value ?? 0}%)`}
              </text>
            )}
            labelLine={false}
          >
            {data.map((_entry, index) => (
              <Cell
                key={index}
                fill={COLORS[index % COLORS.length]}
                fillOpacity={0.8}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: unknown) => `${value}%`}
            contentStyle={{
              backgroundColor: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "0.5rem",
              fontSize: "0.875rem",
              color: "var(--foreground)",
            }}
            itemStyle={{ color: "var(--muted-foreground)" }}
            labelStyle={{ color: "var(--foreground)" }}
          />
          <Legend
            verticalAlign="bottom"
            formatter={(value: string) => (
              <span className="text-sm text-muted-foreground">{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
