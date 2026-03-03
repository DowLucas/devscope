import type { Playbook } from "@devscope/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToolSequenceViz } from "./ToolSequenceViz";

interface PlaybookCardProps {
  playbook: Playbook;
  onClick?: () => void;
}

export function PlaybookCard({ playbook, onClick }: PlaybookCardProps) {
  const metrics = playbook.success_metrics as {
    avg_success_rate?: number;
    typical_sessions?: number;
  };

  return (
    <Card
      className="cursor-pointer hover:border-primary/30 transition-colors"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-semibold">{playbook.name}</CardTitle>
          <Badge variant="outline" className="shrink-0 text-xs">
            {playbook.created_by === "auto" ? "Auto" : "Manual"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground line-clamp-2">
          {playbook.description}
        </p>

        <ToolSequenceViz tools={playbook.tool_sequence} compact />

        {metrics?.avg_success_rate !== undefined && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>
              Success rate:{" "}
              <span className="font-medium text-foreground">
                {Math.round(metrics.avg_success_rate * 100)}%
              </span>
            </span>
            {metrics?.typical_sessions !== undefined && (
              <span>
                Sessions:{" "}
                <span className="font-medium text-foreground">
                  {metrics.typical_sessions}
                </span>
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
