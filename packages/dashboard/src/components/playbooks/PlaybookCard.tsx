import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToolSequenceViz } from "./ToolSequenceViz";
import { timeAgo } from "@/lib/utils";
import type { Playbook } from "@devscope/shared";

interface PlaybookCardProps {
  playbook: Playbook;
  onClick: () => void;
}

export function PlaybookCard({ playbook, onClick }: PlaybookCardProps) {
  return (
    <Card
      className="cursor-pointer hover:bg-accent/5 transition-colors"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium leading-tight">
            {playbook.name}
          </CardTitle>
          <Badge
            variant={playbook.status === "active" ? "default" : "secondary"}
            className="text-xs flex-shrink-0"
          >
            {playbook.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground line-clamp-2">
          {playbook.description}
        </p>

        <ToolSequenceViz tools={playbook.tool_sequence} />

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{playbook.created_by === "auto" ? "Auto-generated" : "Manual"}</span>
          <span>{timeAgo(playbook.created_at)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
