import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend } from "recharts";
import { Card } from "@/components/ui/card";
import type { DimensionView } from "./dimensions";

interface Props {
  dimensions: DimensionView[];
  showTeam: boolean;
}

export function WorkflowRadarChart({ dimensions, showTeam }: Props) {
  const data = dimensions.map((dim) => ({
    dimension: dim.label,
    personal: Math.round((dim.value ?? 0) * 100),
    team: dim.team != null ? Math.round(dim.team * 100) : undefined,
  }));

  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium mb-4">Workflow Profile</h3>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis
            dataKey="dimension"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar
            name="You"
            dataKey="personal"
            stroke="var(--chart-1)"
            fill="var(--chart-1)"
            fillOpacity={0.25}
          />
          {showTeam && (
            <Radar
              name="Team Average"
              dataKey="team"
              stroke="var(--chart-2)"
              fill="var(--chart-2)"
              fillOpacity={0.1}
              strokeDasharray="4 4"
            />
          )}
          <Legend />
        </RadarChart>
      </ResponsiveContainer>
    </Card>
  );
}
