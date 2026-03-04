import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { ChartCard } from "@/components/insights/ChartCard";
import { CHART_COLORS } from "@/components/insights/charts/chartConfig";

interface SkillAssessment {
  dimension: string;
  score: number;
  previous_score: number;
  detail: string;
}

interface SkillRadarChartProps {
  data: SkillAssessment[];
}

export function SkillRadarChart({ data }: SkillRadarChartProps) {
  const chartData = data.map((d) => ({
    dimension: d.dimension,
    Current: d.score,
    Previous: d.previous_score,
  }));

  return (
    <ChartCard
      title="Claude Code Proficiency"
      description="Team proficiency across key Claude Code usage dimensions"
    >
      <ResponsiveContainer width="100%" height={350}>
        <RadarChart data={chartData} outerRadius="75%">
          <PolarGrid stroke="oklch(1 0 0 / 10%)" />
          <PolarAngleAxis
            dataKey="dimension"
            tick={{ fill: "oklch(0.708 0 0)", fontSize: 11 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: "oklch(0.708 0 0)", fontSize: 10 }}
          />
          <Radar
            name="Previous"
            dataKey="Previous"
            stroke={CHART_COLORS.tertiary}
            fill={CHART_COLORS.tertiary}
            fillOpacity={0.15}
            strokeWidth={1.5}
          />
          <Radar
            name="Current"
            dataKey="Current"
            stroke={CHART_COLORS.primary}
            fill={CHART_COLORS.primary}
            fillOpacity={0.25}
            strokeWidth={2}
          />
          <Legend />
        </RadarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
