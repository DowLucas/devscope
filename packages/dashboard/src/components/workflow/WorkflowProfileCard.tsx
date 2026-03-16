import { Card } from "@/components/ui/card";
import type { WorkflowProfile } from "@devscope/shared";

const DIMENSION_INFO: Record<string, { label: string; descriptors: [string, string] }> = {
  iterative_vs_planning: { label: "Iteration Style", descriptors: ["Planning-Heavy", "Highly Iterative"] },
  tool_diversity: { label: "Tool Breadth", descriptors: ["Focused", "Diverse"] },
  recovery_speed: { label: "Recovery Flow", descriptors: ["Methodical", "Quick Recovery"] },
  session_depth: { label: "Session Depth", descriptors: ["Short Sessions", "Deep Sessions"] },
  prompt_density: { label: "Prompt Rhythm", descriptors: ["Sparse", "Dense"] },
  agent_usage: { label: "Agent Leverage", descriptors: ["Manual", "Agent-Heavy"] },
};

interface Props {
  profile: WorkflowProfile;
}

function getDescriptor(key: string, value: number | null): string {
  if (value == null) return "Unknown";
  const info = DIMENSION_INFO[key];
  if (!info) return "";
  return value > 0.6 ? info.descriptors[1] : value < 0.4 ? info.descriptors[0] : "Balanced";
}

export function WorkflowProfileCard({ profile }: Props) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">Profile Summary</h3>
        <span className="text-xs text-muted-foreground">
          {profile.sessions_analyzed} sessions analyzed
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(DIMENSION_INFO).map(([key, info]) => {
          const value = profile[key as keyof typeof profile] as number | null;
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{info.label}</span>
                <span className="text-xs font-medium">
                  {value != null ? `${Math.round(value * 100)}%` : "—"}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${(value ?? 0) * 100}%` }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground">{getDescriptor(key, value)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
