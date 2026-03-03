import { Activity, CheckCircle, Clock, Sparkles, AlertTriangle } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";

interface TeamSummary {
  total_sessions: number;
  completion_rate: number;
  avg_duration_minutes: number;
  patterns_detected: number;
  anti_patterns_detected: number;
  prev_total_sessions: number;
  prev_completion_rate: number;
  prev_avg_duration_minutes: number;
  prev_patterns_detected: number;
  prev_anti_patterns_detected: number;
}

interface TeamSummaryCardsProps {
  summary: TeamSummary | null;
  loading: boolean;
}

function delta(current: number, previous: number): number | undefined {
  if (previous === 0) return current > 0 ? 100 : undefined;
  return Math.round(((current - previous) / previous) * 100);
}

export function TeamSummaryCards({ summary, loading }: TeamSummaryCardsProps) {
  if (loading || !summary) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[120px] rounded-lg bg-card animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      <MetricCard
        label="Sessions"
        value={summary.total_sessions}
        icon={Activity}
        previousValue={summary.prev_total_sessions}
        delta={delta(summary.total_sessions, summary.prev_total_sessions)}
      />
      <MetricCard
        label="Completion Rate"
        value={`${Math.round(summary.completion_rate * 100)}%`}
        icon={CheckCircle}
        previousValue={`${Math.round(summary.prev_completion_rate * 100)}%`}
        delta={delta(summary.completion_rate, summary.prev_completion_rate)}
        status={summary.completion_rate >= 0.8 ? "green" : summary.completion_rate >= 0.5 ? "yellow" : "red"}
      />
      <MetricCard
        label="Avg Duration"
        value={`${Math.round(summary.avg_duration_minutes)}m`}
        icon={Clock}
        previousValue={`${Math.round(summary.prev_avg_duration_minutes)}m`}
        delta={delta(summary.avg_duration_minutes, summary.prev_avg_duration_minutes)}
      />
      <MetricCard
        label="Patterns Detected"
        value={summary.patterns_detected}
        icon={Sparkles}
        previousValue={summary.prev_patterns_detected}
        delta={delta(summary.patterns_detected, summary.prev_patterns_detected)}
      />
      <MetricCard
        label="Anti-Patterns"
        value={summary.anti_patterns_detected}
        icon={AlertTriangle}
        previousValue={summary.prev_anti_patterns_detected}
        delta={delta(summary.anti_patterns_detected, summary.prev_anti_patterns_detected)}
        status={summary.anti_patterns_detected === 0 ? "green" : summary.anti_patterns_detected <= 5 ? "yellow" : "red"}
      />
    </div>
  );
}
