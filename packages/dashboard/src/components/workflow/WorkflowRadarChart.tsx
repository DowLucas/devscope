import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend } from "recharts";
import { Card } from "@/components/ui/card";
import type { WorkflowProfile, TeamWorkflowSummary } from "@devscope/shared";

const DIMENSIONS = [
  { key: "iterative_vs_planning", label: "Iteration Style" },
  { key: "tool_diversity", label: "Tool Breadth" },
  { key: "recovery_speed", label: "Recovery Flow" },
  { key: "session_depth", label: "Session Depth" },
  { key: "prompt_density", label: "Prompt Rhythm" },
  { key: "agent_usage", label: "Agent Leverage" },
] as const;

interface Props {
  profile: WorkflowProfile;
  teamSummary: TeamWorkflowSummary | null;
}

export function WorkflowRadarChart({ profile, teamSummary }: Props) {
  const data = DIMENSIONS.map((dim) => ({
    dimension: dim.label,
    personal: Math.round(((profile[dim.key] as number) ?? 0) * 100),
    team: teamSummary?.dimension_averages?.[dim.key] != null
      ? Math.round(teamSummary.dimension_averages[dim.key] * 100)
      : undefined,
  }));

  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium mb-4">Workflow Profile</h3>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis
            dataKey="dimension"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar
            name="You"
            dataKey="personal"
            stroke="hsl(var(--primary))"
            fill="hsl(var(--primary))"
            fillOpacity={0.2}
          />
          {teamSummary && (
            <Radar
              name="Team Average"
              dataKey="team"
              stroke="hsl(var(--muted-foreground))"
              fill="none"
              strokeDasharray="4 4"
            />
          )}
          <Legend />
        </RadarChart>
      </ResponsiveContainer>
    </Card>
  );
}
