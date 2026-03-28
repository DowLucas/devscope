import type {
  ToolUsageDataPoint,
  SkillUsageDataPoint,
  SessionStatsSummary,
  ProjectActivityDataPoint,
  HourlyDistributionPoint,
  TokenUsageSummary,
  TokenUsageOverTime,
} from "@devscope/shared";
import { useInsightsData } from "@/hooks/useInsightsData";
import { useDateRange } from "@/hooks/useDateRange";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { ExportButton } from "@/components/ui/export-button";
import { PageHeader } from "@/components/ui/page-header";
import { StatCards } from "./StatCards";
import { ToolUsageChart } from "./charts/ToolUsageChart";
import { SkillUsageChart } from "./charts/SkillUsageChart";
import { ProjectActivityChart } from "./charts/ProjectActivityChart";
import { HourlyHeatmap } from "./charts/HourlyHeatmap";
import { PeriodComparison } from "./PeriodComparison";
import { ThroughputCards } from "./ThroughputCards";
import { MinuteActivityChart } from "./charts/MinuteActivityChart";
import { TokenUsageCards } from "./TokenUsageCards";
import { TokenUsageChart } from "./charts/TokenUsageChart";

export function InsightsOverview() {
  const { days } = useDateRange();

  const summary = useInsightsData<SessionStatsSummary>("sessions/summary", undefined, days);
  const tools = useInsightsData<ToolUsageDataPoint[]>("tools", undefined, days);
  const skills = useInsightsData<SkillUsageDataPoint[]>("skills", undefined, days);
  const projects = useInsightsData<ProjectActivityDataPoint[]>("projects", undefined, days);
  const hourly = useInsightsData<HourlyDistributionPoint[]>("hourly", undefined, days);
  const tokenSummary = useInsightsData<TokenUsageSummary>("tokens", undefined, days);
  const tokenOverTime = useInsightsData<TokenUsageOverTime[]>("tokens/over-time", undefined, days);

  return (
    <div className="space-y-6">
      <PageHeader title="Insights">
        <div className="flex items-center gap-2">
          <ExportButton dataType="activity" days={days} />
          <DateRangePicker />
        </div>
      </PageHeader>

      <ThroughputCards />

      <StatCards data={summary.data} loading={summary.loading} days={days} />

      <TokenUsageCards data={tokenSummary.data} loading={tokenSummary.loading} />

      <PeriodComparison />

      <MinuteActivityChart />

      <div className="grid gap-6 lg:grid-cols-2">
        <ToolUsageChart data={tools.data} loading={tools.loading} />
        <ProjectActivityChart data={projects.data} loading={projects.loading} />
      </div>

      <TokenUsageChart data={tokenOverTime.data} loading={tokenOverTime.loading} />

      <SkillUsageChart data={skills.data} loading={skills.loading} />

      <HourlyHeatmap data={hourly.data} loading={hourly.loading} />
    </div>
  );
}
