import type { Playbook } from "@devscope/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToolSequenceViz } from "./ToolSequenceViz";
import { ArrowLeft } from "lucide-react";

interface PlaybookDetailProps {
  playbook: Playbook;
  onBack: () => void;
}

export function PlaybookDetail({ playbook, onBack }: PlaybookDetailProps) {
  const metrics = playbook.success_metrics as {
    avg_success_rate?: number;
    typical_sessions?: number;
  };

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Playbooks
      </button>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-xl">{playbook.name}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {playbook.description}
              </p>
            </div>
            <Badge variant="outline">
              {playbook.created_by === "auto" ? "Auto-discovered" : "Manual"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="text-sm font-medium mb-2">Tool Sequence</h3>
            <ToolSequenceViz tools={playbook.tool_sequence} />
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2">When to Use</h3>
            <p className="text-sm text-muted-foreground">{playbook.when_to_use}</p>
          </div>

          {metrics && (
            <div>
              <h3 className="text-sm font-medium mb-2">Success Metrics</h3>
              <div className="flex gap-6">
                {metrics.avg_success_rate !== undefined && (
                  <div>
                    <p className="text-2xl font-bold">
                      {Math.round(metrics.avg_success_rate * 100)}%
                    </p>
                    <p className="text-xs text-muted-foreground">Avg Success Rate</p>
                  </div>
                )}
                {metrics.typical_sessions !== undefined && (
                  <div>
                    <p className="text-2xl font-bold">{metrics.typical_sessions}</p>
                    <p className="text-xs text-muted-foreground">Sessions Observed</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            Created {new Date(playbook.created_at).toLocaleDateString()}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
