import { useState } from "react";
import type { CommandProjectRow } from "@devscope/shared";
import { useDateRange } from "@/hooks/useDateRange";
import { useCommandsData } from "@/hooks/useCommandsData";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { PageHeader } from "@/components/ui/page-header";
import { CommandTimings } from "./CommandTimings";

/** /dashboard/commands: Bash command timing across projects, or one project. */
export function CommandsView() {
  const { days } = useDateRange();
  const [project, setProject] = useState<string | null>(null);
  const projects = useCommandsData<CommandProjectRow[]>("projects", { days });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commands"
        description="How long the Bash commands Claude runs take, and which ones the sessions wait on most."
      />
      <CommandTimings
        days={days}
        project={project}
        filters={
          <>
            <select
              aria-label="Project"
              value={project ?? ""}
              onChange={(e) => setProject(e.target.value || null)}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
            >
              <option value="">All projects</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.project} value={p.project}>
                  {p.project}
                </option>
              ))}
              {project && !(projects.data ?? []).some((p) => p.project === project) && (
                <option value={project}>{project}</option>
              )}
            </select>
            <DateRangePicker />
          </>
        }
      />
    </div>
  );
}
