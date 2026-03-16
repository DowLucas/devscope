import type { TeamToolTopology } from "@devscope/shared";

const PROFICIENCY_COLORS: Record<string, string> = {
  strong: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  developing: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  struggling: "bg-destructive/20 text-destructive border-destructive/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

const COVERAGE_LABELS: Record<string, string> = {
  widespread: "Widespread",
  partial: "Partial",
  narrow: "Narrow",
  unknown: "Unknown",
};

interface Props {
  data: TeamToolTopology[];
  loading: boolean;
}

export function ToolProficiencyGrid({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No tool usage data computed yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="grid grid-cols-[1fr_80px_80px_80px_100px] gap-2 px-3 text-xs font-medium text-muted-foreground">
        <span>Tool</span>
        <span className="text-right">Uses</span>
        <span className="text-right">Fail %</span>
        <span className="text-right">Users</span>
        <span className="text-right">Proficiency</span>
      </div>
      {data.map((t) => (
        <div
          key={t.id}
          className={`grid grid-cols-[1fr_80px_80px_80px_100px] gap-2 items-center px-3 py-2 rounded-lg border ${PROFICIENCY_COLORS[t.proficiency_level]}`}
        >
          <span className="text-sm font-medium truncate">{t.tool_name}</span>
          <span className="text-sm text-right">{t.total_uses}</span>
          <span className="text-sm text-right">
            {t.failure_rate != null ? `${(Number(t.failure_rate) * 100).toFixed(1)}%` : "—"}
          </span>
          <span className="text-sm text-right">{t.unique_users}</span>
          <span className="text-xs text-right capitalize">
            {t.proficiency_level} · {COVERAGE_LABELS[t.coverage_level]}
          </span>
        </div>
      ))}
    </div>
  );
}
