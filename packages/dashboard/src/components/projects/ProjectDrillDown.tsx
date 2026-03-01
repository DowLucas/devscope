import { ArrowLeft } from "lucide-react";
import type {
  ActivityDataPoint,
  ToolUsageDataPoint,
  ProjectContributor,
} from "@devscope/shared";
import { useInsightsData } from "@/hooks/useInsightsData";
import { useDateRange } from "@/hooks/useDateRange";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { ActivityChart } from "@/components/insights/charts/ActivityChart";
import { ToolUsageChart } from "@/components/insights/charts/ToolUsageChart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChartCard } from "@/components/insights/ChartCard";

interface ProjectDrillDownProps {
  projectName: string;
  onBack: () => void;
}

export function ProjectDrillDown({ projectName, onBack }: ProjectDrillDownProps) {
  const { days } = useDateRange();
  const activityEndpoint = `projects/${encodeURIComponent(projectName)}/activity`;
  const toolsEndpoint = `projects/${encodeURIComponent(projectName)}/tools`;
  const contributorsEndpoint = `projects/${encodeURIComponent(projectName)}/contributors`;

  const activity = useInsightsData<ActivityDataPoint[]>(activityEndpoint, undefined, days);
  const tools = useInsightsData<ToolUsageDataPoint[]>(toolsEndpoint, undefined, days);
  const contributors = useInsightsData<ProjectContributor[]>(contributorsEndpoint, undefined, days);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="border-l border-border pl-3">
            <h2 className="text-lg font-semibold">{projectName}</h2>
          </div>
        </div>
        <DateRangePicker />
      </div>

      <ActivityChart data={activity.data} loading={activity.loading} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Contributors" loading={contributors.loading}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Developer</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead className="text-right">Prompts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(contributors.data ?? []).map((c) => (
                <TableRow key={c.developer_id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-right">{c.session_count}</TableCell>
                  <TableCell className="text-right">{c.prompt_count}</TableCell>
                </TableRow>
              ))}
              {(!contributors.data || contributors.data.length === 0) && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    No contributors
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ChartCard>

        <ToolUsageChart data={tools.data} loading={tools.loading} />
      </div>
    </div>
  );
}
