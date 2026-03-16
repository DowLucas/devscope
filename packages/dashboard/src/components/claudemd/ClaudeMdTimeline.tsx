import { Hash, Calendar } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useState } from "react";

interface TimelineEntry {
  snapshot: {
    id: string;
    content_hash: string;
    content_size: number;
    content_text: string | null;
    captured_at: string;
  };
  correlation: {
    sessions_count: number;
    avg_failure_rate: number | null;
    avg_prompt_count: number | null;
    avg_session_duration_min: number | null;
  } | null;
}

interface ClaudeMdTimelineProps {
  entries: TimelineEntry[];
  loading: boolean;
}

export function ClaudeMdTimeline({ entries, loading }: ClaudeMdTimelineProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No CLAUDE.md snapshots captured yet. Start a session in a project with a CLAUDE.md file.
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
      <div className="space-y-4">
        {entries.map((entry) => {
          const isExpanded = expandedId === entry.snapshot.id;
          return (
            <div key={entry.snapshot.id} className="relative pl-10">
              <div className="absolute left-2.5 top-4 h-3 w-3 rounded-full bg-primary border-2 border-background" />
              <Card
                className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : entry.snapshot.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{new Date(entry.snapshot.captured_at).toLocaleDateString()}</span>
                      <span className="text-muted-foreground">
                        {new Date(entry.snapshot.captured_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Hash className="h-3 w-3" />
                        {entry.snapshot.content_hash.slice(0, 8)}
                      </span>
                      <span>{(entry.snapshot.content_size / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                  {entry.correlation && (
                    <div className="text-right text-xs space-y-0.5">
                      <div>{entry.correlation.sessions_count} sessions</div>
                      {entry.correlation.avg_failure_rate != null && (
                        <div className={entry.correlation.avg_failure_rate > 0.2 ? "text-destructive" : "text-emerald-400"}>
                          {(entry.correlation.avg_failure_rate * 100).toFixed(1)}% fail rate
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {isExpanded && entry.snapshot.content_text && (
                  <pre className="mt-3 p-3 rounded bg-muted/50 text-xs overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {entry.snapshot.content_text}
                  </pre>
                )}
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
