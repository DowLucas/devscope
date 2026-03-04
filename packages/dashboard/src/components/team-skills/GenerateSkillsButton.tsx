import { Sparkles, Loader2 } from "lucide-react";
import { useTeamSkillStore } from "@/stores/teamSkillStore";

export function GenerateSkillsButton() {
  const { generating, generateSkills } = useTeamSkillStore();

  return (
    <button
      onClick={() => generateSkills()}
      disabled={generating}
      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
    >
      {generating ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating Workflow Skills...
        </>
      ) : (
        <>
          <Sparkles className="h-4 w-4" />
          Generate Workflow Skills
        </>
      )}
    </button>
  );
}
