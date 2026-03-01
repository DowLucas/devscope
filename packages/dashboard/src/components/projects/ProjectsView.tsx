import { useCallback } from "react";
import { useLocation, useRoute } from "wouter";
import type { ProjectDetail } from "@devscope/shared";
import { useInsightsData } from "@/hooks/useInsightsData";
import { useDateRange } from "@/hooks/useDateRange";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { ProjectCard } from "./ProjectCard";
import { ProjectDrillDown } from "./ProjectDrillDown";

export function ProjectsView() {
  const { days } = useDateRange();
  const overview = useInsightsData<ProjectDetail[]>("projects/overview", undefined, days);
  const [, navigate] = useLocation();
  const [, params] = useRoute("/projects/detail/:name");
  const selectedProject = params?.name ? decodeURIComponent(params.name) : null;

  const selectProject = useCallback((name: string) => {
    navigate(`/projects/detail/${encodeURIComponent(name)}`);
  }, [navigate]);

  const goBack = useCallback(() => {
    navigate("/projects");
  }, [navigate]);

  if (selectedProject) {
    return <ProjectDrillDown projectName={selectedProject} onBack={goBack} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Projects</h2>
        <DateRangePicker />
      </div>

      {overview.loading ? (
        <div className="text-muted-foreground text-center py-12 text-sm">
          Loading projects...
        </div>
      ) : (overview.data ?? []).length === 0 ? (
        <div className="text-muted-foreground text-center py-12 text-sm">
          No projects found.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(overview.data ?? []).map((project, i) => (
            <ProjectCard
              key={project.name}
              project={project}
              index={i}
              onClick={() => selectProject(project.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
