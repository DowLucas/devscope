import { useManagerSummary } from "@/hooks/useManagerSummary";
import { Skeleton } from "@/components/ui/skeleton";
import { TeamSummaryCards } from "./TeamSummaryCards";
import { FailureClustersTable } from "@/components/failures/FailureClustersTable";
import { AlertTriangle } from "lucide-react";

function SessionsAttentionList({ sessions }: { sessions: { session_id: string; project_name: string; tool_failure_rate: number }[] }) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Sessions Needing Attention
        </h3>
        <p className="text-muted-foreground text-sm">No sessions with high failure rates.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        Sessions Needing Attention
      </h3>
      <div className="space-y-2">
        {sessions.map((s) => (
          <div key={s.session_id} className="flex items-center justify-between text-sm">
            <span className="truncate">{s.project_name || "Unknown project"}</span>
            <span className="text-destructive font-medium">{Math.round(s.tool_failure_rate * 100)}% failures</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ManagerDashboard() {
  const { data, loading } = useManagerSummary(7);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-muted-foreground text-center py-12 text-sm">
        Unable to load manager summary.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TeamSummaryCards
        sessions={data.velocity.sessions}
        prompts={data.velocity.prompts}
        tool_calls={data.velocity.tool_calls}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <SessionsAttentionList sessions={data.sessions_needing_attention} />
        <FailureClustersTable
          data={data.failure_clusters.map((c) => ({
            ...c,
            error_messages: [],
          }))}
          loading={false}
        />
      </div>
    </div>
  );
}
