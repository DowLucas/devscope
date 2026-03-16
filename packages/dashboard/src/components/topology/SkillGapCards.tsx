import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { TeamSkillGap } from "@devscope/shared";

const SEVERITY_CLASSES: Record<string, string> = {
  info: "bg-blue-500/15 text-blue-400",
  warning: "bg-amber-500/15 text-amber-400",
  critical: "bg-destructive/15 text-destructive",
};

const GAP_TYPE_LABELS: Record<string, string> = {
  high_failure: "High Failure Rate",
  low_adoption: "Low Adoption",
  single_expert: "Single Expert",
  degrading: "Degrading",
};

interface Props {
  gaps: TeamSkillGap[];
  loading: boolean;
}

export function SkillGapCards({ gaps, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-20 rounded-lg bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (gaps.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        No skill gaps detected.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {gaps.map((gap) => (
        <Card key={gap.id} className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-400 shrink-0" />
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_CLASSES[gap.severity]}`}>
                  {gap.severity}
                </span>
                <span className="text-xs text-muted-foreground">
                  {GAP_TYPE_LABELS[gap.gap_type] ?? gap.gap_type}
                </span>
              </div>
              <p className="text-sm font-medium">{gap.tool_name}</p>
              <p className="text-sm text-muted-foreground">{gap.description}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
