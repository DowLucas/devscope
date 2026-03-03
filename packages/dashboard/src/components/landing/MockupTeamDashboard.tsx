import {
  TrendingUp,
  Lightbulb,
  AlertTriangle,
  FileText,
  CheckCircle,
  Sparkles,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  AI insights & reports mockup for the landing page (non-technical)  */
/* ------------------------------------------------------------------ */

const INSIGHTS = [
  {
    icon: TrendingUp,
    iconColor: "text-blue-400",
    title: "Velocity up 18% this week",
    severity: "Info",
    severityClass: "bg-muted text-muted-foreground",
    narrative:
      "Team output increased across all metrics. Prompt volume and tool usage both trending higher than the 4-week average.",
  },
  {
    icon: AlertTriangle,
    iconColor: "text-amber-400",
    title: "Possible burnout risk: Sarah K",
    severity: "Warning",
    severityClass: "border border-amber-500/30 text-amber-400",
    narrative:
      "34 sessions in 5 days with decreasing prompt quality scores. Consider reviewing workload.",
  },
  {
    icon: Lightbulb,
    iconColor: "text-emerald-400",
    title: "Recommend pairing on auth-service",
    severity: "Info",
    severityClass: "bg-muted text-muted-foreground",
    narrative:
      "Alex M has had 4 stuck sessions on auth-service this week. Jordan P resolved similar issues recently.",
  },
] as const;

const REPORTS = [
  {
    title: "Weekly Team Digest",
    type: "digest",
    time: "2h ago",
    readTime: "3 min read",
  },
  {
    title: "Sprint Velocity Analysis",
    type: "analysis",
    time: "1d ago",
    readTime: "5 min read",
  },
] as const;

export function MockupTeamDashboard() {
  return (
    <div className="px-5 py-4 space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-purple-400" />
        <span className="text-sm font-medium text-purple-400">
          AI Insights
        </span>
        <span className="text-xs text-muted-foreground">— last 7 days</span>
      </div>

      {/* Insight cards */}
      <div className="space-y-2">
        {INSIGHTS.map((insight) => {
          const Icon = insight.icon;
          return (
            <div
              key={insight.title}
              className="rounded-lg border border-border bg-card p-3 flex items-start gap-3"
            >
              <Icon className={`size-4 mt-0.5 shrink-0 ${insight.iconColor}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-foreground truncate">
                    {insight.title}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0 text-[10px] shrink-0 ${insight.severityClass}`}
                  >
                    {insight.severity}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-1">
                  {insight.narrative}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Reports row */}
      <div className="flex items-center gap-2 pt-0.5">
        <FileText className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">
          Recent Reports
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {REPORTS.map((report) => (
          <div
            key={report.title}
            className="rounded-lg border border-border bg-card px-3 py-2 flex items-center gap-2.5"
          >
            <CheckCircle className="size-3.5 text-emerald-500 shrink-0" />
            <div className="min-w-0">
              <span className="text-xs font-medium text-foreground truncate block">
                {report.title}
              </span>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="capitalize">{report.type}</span>
                <span>·</span>
                <span>{report.time}</span>
                <span>·</span>
                <span>{report.readTime}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
