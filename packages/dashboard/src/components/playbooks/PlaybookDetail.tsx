import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToolSequenceViz } from "./ToolSequenceViz";
import { apiFetch } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import type { Playbook } from "@devscope/shared";

interface PlaybookDetailProps {
  playbookId: string;
  onBack: () => void;
}

interface PlaybookWithAdoption extends Playbook {
  adoption?: { sessions_using: number; avg_success_rate: number };
}

export function PlaybookDetail({ playbookId, onBack }: PlaybookDetailProps) {
  const [playbook, setPlaybook] = useState<PlaybookWithAdoption | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/api/playbooks/${playbookId}`)
      .then((r) => r.json())
      .then((data) => {
        setPlaybook(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [playbookId]);

  if (loading) {
    return <div className="animate-pulse h-96 bg-muted/10 rounded-lg" />;
  }

  if (!playbook) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Playbook not found
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Playbooks
      </button>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>{playbook.name}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {playbook.description}
              </p>
            </div>
            <Badge variant={playbook.status === "active" ? "default" : "secondary"}>
              {playbook.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h4 className="text-sm font-medium mb-2">Tool Sequence</h4>
            <ToolSequenceViz tools={playbook.tool_sequence} />
          </div>

          <div>
            <h4 className="text-sm font-medium mb-1">When to Use</h4>
            <p className="text-sm text-muted-foreground">{playbook.when_to_use}</p>
          </div>

          {playbook.success_metrics && Object.keys(playbook.success_metrics).length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Success Metrics</h4>
              <div className="flex gap-4">
                {Object.entries(playbook.success_metrics).map(([key, val]) => (
                  <div key={key} className="text-center">
                    <p className="text-lg font-bold">
                      {typeof val === "number" && val < 1
                        ? `${Math.round(val * 100)}%`
                        : String(val)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {key.replace(/_/g, " ")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {playbook.adoption && (
            <div>
              <h4 className="text-sm font-medium mb-2">Adoption (Last 30 Days)</h4>
              <div className="flex gap-6">
                <div className="text-center">
                  <p className="text-lg font-bold">{playbook.adoption.sessions_using}</p>
                  <p className="text-xs text-muted-foreground">Sessions</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold">
                    {Math.round(playbook.adoption.avg_success_rate * 100)}%
                  </p>
                  <p className="text-xs text-muted-foreground">Success Rate</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
            <span>Created by: {playbook.created_by}</span>
            <span>{timeAgo(playbook.created_at)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
