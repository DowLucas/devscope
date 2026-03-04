import { useCallback, useEffect, useState } from "react";
import { Users, Eye, Lock, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import type { ConsentOverview as ConsentOverviewType, DataRequest } from "@devscope/shared";
import { toast } from "sonner";
import { useTeamStore } from "@/stores/teamStore";

export function ConsentOverview() {
  const [overview, setOverview] = useState<ConsentOverviewType | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await apiFetch("/api/privacy/consent/overview");
      setOverview(await res.json());
    } catch (err) {
      console.error("[ConsentOverview]", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!overview) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard label="Team Developers" value={overview.total_developers} icon={Users} />
        <MetricCard label="Sharing Details (Opt-in)" value={overview.sharing_details} icon={Eye} />
        <MetricCard label="Privacy Mode Sessions (30d)" value={overview.privacy_mode_count} icon={Lock} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="h-4 w-4 text-muted-foreground" />
            Data Categories
          </CardTitle>
          <CardDescription>
            What DevScope collects and whether opt-in is required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {overview.data_categories.map((cat) => (
              <div key={cat.name} className="flex items-start justify-between gap-4 py-2 border-b border-border last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{cat.name}</p>
                  <p className="text-xs text-muted-foreground">{cat.description}</p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {cat.opt_in_required ? (
                    <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-400">
                      Opt-in Required
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      Always Collected
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function DataRequestsView() {
  const [requests, setRequests] = useState<DataRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const isAdmin = useTeamStore((s) => s.isAdmin());

  const fetchRequests = useCallback(async () => {
    try {
      const res = await apiFetch("/api/privacy/consent/data-requests");
      setRequests(await res.json());
    } catch (err) {
      console.error("[DataRequests]", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  async function handleCreateRequest(type: "export" | "deletion") {
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/privacy/consent/data-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_type: type }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create request");
      }
      toast.success(`${type === "export" ? "Export" : "Deletion"} request submitted`);
      fetchRequests();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create request");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateStatus(requestId: string, status: "completed" | "rejected") {
    try {
      const res = await apiFetch(`/api/privacy/consent/data-requests/${requestId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success(`Request ${status}`);
      fetchRequests();
    } catch {
      toast.error("Failed to update request");
    }
  }

  const STATUS_COLORS: Record<string, string> = {
    pending: "bg-amber-500/15 text-amber-400",
    processing: "bg-blue-500/15 text-blue-400",
    completed: "bg-emerald-500/15 text-emerald-400",
    rejected: "bg-red-500/15 text-red-400",
  };

  if (loading) {
    return <Skeleton className="h-64 rounded-xl" />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Request Your Data</CardTitle>
          <CardDescription>
            Submit a request to export or delete your personal data from DevScope.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <button
              onClick={() => handleCreateRequest("export")}
              disabled={submitting}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              Request Data Export
            </button>
            <button
              onClick={() => handleCreateRequest("deletion")}
              disabled={submitting}
              className="rounded-md border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-2 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
            >
              Request Data Deletion
            </button>
          </div>
        </CardContent>
      </Card>

      {requests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{isAdmin ? "All Data Requests" : "Your Requests"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {requests.map((req) => (
                <div key={req.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-[10px]">
                      {req.request_type}
                    </Badge>
                    {req.developer_name && (
                      <span className="text-xs text-muted-foreground">{req.developer_name}</span>
                    )}
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_COLORS[req.status] ?? ""}`}>
                      {req.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(req.requested_at).toLocaleDateString()}
                    </span>
                    {isAdmin && req.status === "pending" && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleUpdateStatus(req.id, "completed")}
                          className="text-xs text-emerald-400 hover:underline"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleUpdateStatus(req.id, "rejected")}
                          className="text-xs text-red-400 hover:underline"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
