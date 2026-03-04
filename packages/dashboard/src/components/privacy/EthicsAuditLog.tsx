import { useCallback, useEffect, useState } from "react";
import { Shield, Eye, Bot, Lock, Trash2, Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import type { EthicsAuditSummary, EthicsAuditEntry } from "@devscope/shared";

const EVENT_TYPE_META: Record<string, { label: string; icon: typeof Shield; color: string }> = {
  sensitive_fields_stripped: { label: "Fields Stripped", icon: Eye, color: "text-blue-400" },
  ai_individual_reference_blocked: { label: "AI Guardrail", icon: Bot, color: "text-violet-400" },
  privacy_mode_activated: { label: "Privacy Mode", icon: Lock, color: "text-emerald-400" },
  data_request_processed: { label: "Data Request", icon: Trash2, color: "text-amber-400" },
  retention_purge_executed: { label: "Retention Purge", icon: Database, color: "text-red-400" },
};

export function EthicsAuditLog() {
  const [summary, setSummary] = useState<EthicsAuditSummary[]>([]);
  const [entries, setEntries] = useState<EthicsAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, entriesRes] = await Promise.all([
        apiFetch("/api/ethics/summary?days=7"),
        apiFetch(`/api/ethics/audit?limit=50${filter ? `&event_type=${filter}` : ""}`),
      ]);
      if (!summaryRes.ok || !entriesRes.ok) {
        setError("Failed to load audit data");
        return;
      }
      const rawSummary = await summaryRes.json();
      const rawEntries = await entriesRes.json();
      // Normalize camelCase fallbacks
      type R = Record<string, unknown>;
      setSummary((rawSummary as R[]).map((s) => ({
        event_type: String(s.event_type ?? s.eventType ?? "") as EthicsAuditSummary["event_type"],
        count: Number(s.count ?? 0),
        last_occurred: (s.last_occurred ?? s.lastOccurred ?? null) as string | null,
      })));
      setEntries((rawEntries as R[]).map((e) => ({
        id: String(e.id),
        organization_id: (e.organization_id ?? e.organizationId ?? null) as string | null,
        event_type: String(e.event_type ?? e.eventType ?? "") as EthicsAuditEntry["event_type"],
        details: (e.details ?? null) as Record<string, unknown> | null,
        created_at: String(e.created_at ?? e.createdAt ?? ""),
      })));
    } catch (err) {
      console.error("[EthicsAuditLog]", err);
      setError(err instanceof Error ? err.message : "Failed to load audit data");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function getCount(type: string): number {
    return summary.find((s) => s.event_type === type)?.count ?? 0;
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          {error}
        </CardContent>
      </Card>
    );
  }

  const totalThisWeek = summary.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricCard label="Guardrails Activated (7d)" value={totalThisWeek} icon={Shield} />
        <MetricCard label="Fields Stripped" value={getCount("sensitive_fields_stripped")} icon={Eye} />
        <MetricCard label="Privacy Sessions" value={getCount("privacy_mode_activated")} icon={Lock} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Audit Log</CardTitle>
            <div className="flex gap-1.5">
              <button
                onClick={() => setFilter(null)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  !filter ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                All
              </button>
              {Object.entries(EVENT_TYPE_META).map(([type, meta]) => (
                <button
                  key={type}
                  onClick={() => setFilter(type)}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${
                    filter === type ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {meta.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No audit events recorded yet. Events will appear as the system processes data.
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {entries.map((entry) => {
                const meta = EVENT_TYPE_META[entry.event_type] ?? EVENT_TYPE_META.sensitive_fields_stripped;
                const Icon = meta.icon;
                return (
                  <div key={entry.id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                    <Icon className={`h-4 w-4 shrink-0 ${meta.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {meta.label}
                        </Badge>
                        {entry.details && Object.keys(entry.details).length > 0 && (
                          <span className="text-xs text-muted-foreground truncate">
                            {formatDetails(entry.details)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(entry.created_at).toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatDetails(details: Record<string, unknown>): string {
  if (details.fields) {
    const fields = Array.isArray(details.fields) ? details.fields.map(String) : [String(details.fields)];
    return `Fields: ${fields.join(", ")}`;
  }
  if (details.action) return String(details.action);
  if (details.events_deleted != null && details.sessions_anonymized != null) {
    return `${details.events_deleted} events deleted, ${details.sessions_anonymized} anonymized`;
  }
  return Object.entries(details).map(([k, v]) => `${k}: ${String(v)}`).slice(0, 2).join(", ");
}
