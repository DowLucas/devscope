import { useEffect, useState } from "react";
import type { DeveloperComparisonEntry, DeveloperLeaderboardEntry } from "@devscope/shared";
import { useInsightsData } from "@/hooks/useInsightsData";
import { useDateRange } from "@/hooks/useDateRange";
import { apiFetch } from "@/lib/api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { ChartCard } from "./ChartCard";
import { ChartTooltip } from "./charts/ChartTooltip";
import { CHART_COLORS, AXIS_STYLE, GRID_STYLE } from "./charts/chartConfig";

export function DeveloperComparison() {
  const { days } = useDateRange();
  const leaderboard = useInsightsData<DeveloperLeaderboardEntry[]>("leaderboard", undefined, days);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<DeveloperComparisonEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedIds.length < 2) {
      setComparison(null);
      return;
    }
    setLoading(true);
    apiFetch(`/api/insights/comparison?developerIds=${selectedIds.join(",")}&days=${days}`)
      .then((r) => r.json())
      .then((d) => {
        setComparison(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [selectedIds, days]);

  const toggleDev = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <ChartCard title="Developer Comparison" loading={leaderboard.loading}>
      <div className="mb-4">
        <p className="text-xs text-muted-foreground mb-2">Select 2+ developers to compare:</p>
        <div className="flex flex-wrap gap-1">
          {(leaderboard.data ?? []).map((dev) => (
            <button
              key={dev.id}
              onClick={() => toggleDev(dev.id)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                selectedIds.includes(dev.id)
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              {dev.name}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="text-sm text-muted-foreground text-center py-8">Loading comparison...</div>
      )}

      {comparison && comparison.length >= 2 && (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={comparison}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="name" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={ChartTooltip} />
            <Legend />
            <Bar dataKey="prompts" name="Prompts" fill={CHART_COLORS.primary} />
            <Bar dataKey="tool_calls" name="Tool Calls" fill={CHART_COLORS.secondary} />
            <Bar dataKey="sessions" name="Sessions" fill={CHART_COLORS.tertiary} />
          </BarChart>
        </ResponsiveContainer>
      )}

      {selectedIds.length < 2 && !loading && (
        <div className="text-sm text-muted-foreground text-center py-8">
          Select at least 2 developers to see comparison
        </div>
      )}
    </ChartCard>
  );
}
