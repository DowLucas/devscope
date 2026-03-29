import type { TokenUsageSummary } from "@devscope/shared";
import { MetricCard } from "@/components/ui/metric-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Coins, DollarSign, Percent, Zap, Flame, TrendingUp, Layers, ArrowDownToLine } from "lucide-react";
import { formatTokenCount, formatCost } from "@/lib/utils";

interface TokenUsageCardsProps {
  data: TokenUsageSummary | null;
  loading: boolean;
}

export function TokenUsageCards({ data, loading }: TokenUsageCardsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const totalTokens = data
    ? data.total_input_tokens + data.total_output_tokens
    : 0;
  const hasData = data && data.sessions_with_token_data > 0;

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <MetricCard
        label="Total Tokens"
        value={hasData ? formatTokenCount(totalTokens) : "—"}
        icon={Zap}
      />
      <MetricCard
        label="Estimated Cost"
        value={hasData ? formatCost(data.total_estimated_cost_usd) : "—"}
        icon={DollarSign}
      />
      <MetricCard
        label="Avg Cost / Session"
        value={hasData ? formatCost(data.avg_cost_per_session_usd) : "—"}
        icon={Coins}
      />
      <MetricCard
        label="Cache Hit Rate"
        value={hasData ? `${data.cache_hit_rate.toFixed(1)}%` : "—"}
        icon={Percent}
      />
      <MetricCard
        label="Avg Burn Rate"
        value={hasData ? `${formatTokenCount(data.avg_burn_rate)}/min` : "—"}
        icon={Flame}
      />
      <MetricCard
        label="Peak Burn Rate"
        value={hasData ? `${formatTokenCount(data.max_burn_rate)}/min` : "—"}
        icon={TrendingUp}
      />
      <MetricCard
        label="Sessions Compacted"
        value={hasData ? `${data.sessions_compacted} (${data.total_compactions} total)` : "—"}
        icon={Layers}
      />
      <MetricCard
        label="Peak Context Usage"
        value={hasData && data.max_peak_context_tokens > 0
          ? formatTokenCount(data.max_peak_context_tokens)
          : "—"}
        icon={ArrowDownToLine}
      />
    </div>
  );
}
