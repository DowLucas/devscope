import type { ToolFailureRatePoint, FailureCluster } from "@devscope/shared";
import { useInsightsData } from "@/hooks/useInsightsData";
import { useDateRange } from "@/hooks/useDateRange";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { FailureRateChart } from "./FailureRateChart";
import { FailureClustersTable } from "./FailureClustersTable";
import { AlertRulesConfig } from "./AlertRulesConfig";

export function FailuresView() {
  const { days } = useDateRange();
  const failures = useInsightsData<ToolFailureRatePoint[]>("failures", undefined, days);
  const clusters = useInsightsData<FailureCluster[]>("failure-clusters", undefined, days);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Tool Failures</h2>
        <DateRangePicker />
      </div>

      <FailureRateChart data={failures.data} loading={failures.loading} />

      <div className="grid gap-6 lg:grid-cols-2">
        <FailureClustersTable data={clusters.data} loading={clusters.loading} />
        <AlertRulesConfig />
      </div>
    </div>
  );
}
