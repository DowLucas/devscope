import { useState } from "react";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { useClaudeMdProjects, useClaudeMdTimeline } from "@/hooks/useClaudeMdEvolution";
import { ClaudeMdTimeline } from "./ClaudeMdTimeline";
import { ClaudeMdQualityChart } from "./ClaudeMdQualityChart";

export function ClaudeMdEvolutionView() {
  const { projects, loading: projectsLoading } = useClaudeMdProjects();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const { timeline, loading: timelineLoading } = useClaudeMdTimeline(selectedProject);

  // Auto-select first project
  if (!selectedProject && projects.length > 0) {
    setSelectedProject(projects[0].project_path);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="CLAUDE.md Evolution"
        description="Track how your CLAUDE.md files change over time and correlate with session quality"
      >
        {projects.length > 1 && (
          <select
            value={selectedProject ?? ""}
            onChange={(e) => setSelectedProject(e.target.value || null)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          >
            {projects.map((p) => (
              <option key={p.project_path} value={p.project_path}>
                {p.project_name} ({p.snapshot_count} snapshots)
              </option>
            ))}
          </select>
        )}
      </PageHeader>

      {projectsLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-muted/50 animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
          <h3 className="text-sm font-medium mb-1">No CLAUDE.md data yet</h3>
          <p className="text-sm text-muted-foreground">
            Start a Claude Code session in a project with a CLAUDE.md file to begin tracking.
          </p>
        </div>
      ) : (
        <>
          <ClaudeMdQualityChart entries={timeline} />
          <div>
            <h3 className="text-sm font-medium mb-3">Version History</h3>
            <ClaudeMdTimeline entries={timeline} loading={timelineLoading} />
          </div>
        </>
      )}
    </div>
  );
}
