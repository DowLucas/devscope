import { useTeamTopology } from "@/hooks/useTeamTopology";
import { ToolProficiencyGrid } from "./ToolProficiencyGrid";
import { SkillGapCards } from "./SkillGapCards";

export function TeamTopologyTab() {
  const { topology, gaps, loading } = useTeamTopology();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-3">Tool Proficiency Overview</h3>
        <ToolProficiencyGrid data={topology} loading={loading} />
      </div>
      <div>
        <h3 className="text-sm font-medium mb-3">Identified Skill Gaps</h3>
        <SkillGapCards gaps={gaps} loading={loading} />
      </div>
    </div>
  );
}
