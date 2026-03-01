import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAiInsights } from "@/hooks/useAiInsights";
import { AiInsightCard } from "./AiInsightCard";
import { Skeleton } from "@/components/ui/skeleton";

const SEVERITY_FILTERS = ["all", "critical", "warning", "info"] as const;
const TYPE_FILTERS = ["all", "anomaly", "trend", "comparison", "recommendation"] as const;

export function AiInsightsFeed() {
  const { insights, insightsLoading, generateInsights } = useAiInsights();
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const filtered = insights.filter((i) => {
    if (severityFilter !== "all" && i.severity !== severityFilter) return false;
    if (typeFilter !== "all" && i.type !== typeFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex gap-1 rounded-lg border border-border p-1">
            {SEVERITY_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setSeverityFilter(s)}
                className={`rounded-md px-2.5 py-1 text-xs capitalize transition-colors ${
                  severityFilter === s
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-lg border border-border p-1">
            {TYPE_FILTERS.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`rounded-md px-2.5 py-1 text-xs capitalize transition-colors ${
                  typeFilter === t
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => generateInsights(7)}
          disabled={insightsLoading}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${insightsLoading ? "animate-spin" : ""}`}
          />
          Generate Now
        </button>
      </div>

      {insightsLoading && insights.length === 0 && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!insightsLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">No insights yet.</p>
          <p className="text-xs mt-1">
            Click "Generate Now" to analyze recent activity.
          </p>
        </div>
      )}

      <div className="grid gap-3">
        {filtered.map((insight) => (
          <AiInsightCard key={insight.id} insight={insight} />
        ))}
      </div>
    </div>
  );
}
