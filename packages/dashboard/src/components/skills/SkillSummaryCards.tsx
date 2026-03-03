import { Target, TrendingUp, AlertTriangle, Zap } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";

interface SkillSummaryCardsProps {
  summary: {
    tool_mastery_rate: number;
    anti_pattern_count: number;
    effective_patterns_used: number;
    avg_session_quality: number;
    period_weeks: number;
  } | null;
  loading: boolean;
}

export function SkillSummaryCards({ summary, loading }: SkillSummaryCardsProps) {
  if (loading || !summary) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[120px] rounded-lg bg-card animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricCard
        label="Tool Mastery"
        value={`${Math.round(summary.tool_mastery_rate * 100)}%`}
        icon={Target}
        status={summary.tool_mastery_rate >= 0.8 ? "green" : summary.tool_mastery_rate >= 0.6 ? "yellow" : "red"}
      />
      <MetricCard
        label="Session Quality"
        value={`${Math.round(summary.avg_session_quality * 100)}%`}
        icon={Zap}
        status={summary.avg_session_quality >= 0.8 ? "green" : summary.avg_session_quality >= 0.6 ? "yellow" : "red"}
      />
      <MetricCard
        label="Effective Patterns"
        value={summary.effective_patterns_used}
        icon={TrendingUp}
      />
      <MetricCard
        label={`Anti-Patterns (${summary.period_weeks}w)`}
        value={summary.anti_pattern_count}
        icon={AlertTriangle}
        status={summary.anti_pattern_count === 0 ? "green" : summary.anti_pattern_count <= 3 ? "yellow" : "red"}
      />
    </div>
  );
}
