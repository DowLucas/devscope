import { useEffect } from "react";
import { Fingerprint } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { useWorkflowProfileStore } from "@/stores/workflowProfileStore";
import { WorkflowRadarChart } from "./WorkflowRadarChart";
import { WorkflowProfileCard } from "./WorkflowProfileCard";

export function WorkflowProfileView() {
  const { profile, teamSummary, loading, fetchAll } = useWorkflowProfileStore();

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflow DNA"
        description="Your personal workflow profile — how you use Claude Code compared to your team"
      />

      {loading ? (
        <div className="space-y-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-48 rounded-lg bg-muted/50 animate-pulse" />
          ))}
        </div>
      ) : !profile ? (
        <div className="text-center py-12">
          <Fingerprint className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
          <h3 className="text-sm font-medium mb-1">No workflow profile yet</h3>
          <p className="text-sm text-muted-foreground">
            Your workflow profile will be generated after enough session data is collected.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <WorkflowRadarChart profile={profile} teamSummary={teamSummary} />
          <WorkflowProfileCard profile={profile} />
        </div>
      )}
    </div>
  );
}
