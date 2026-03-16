import { useEffect, useState } from "react";
import type { BenchmarkPosition } from "@devscope/shared";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";

function metricLabel(name: string): string {
  const labels: Record<string, string> = {
    sessions_per_day: "Sessions / Day",
    tool_success_rate: "Tool Success Rate",
    prompts_per_session: "Prompts / Session",
    anti_pattern_rate: "Anti-Pattern Rate",
    agent_delegation_pct: "Agent Delegation %",
    avg_session_duration_min: "Avg Session Duration",
    team_size: "Team Size",
  };
  return labels[name] ?? name;
}

function metricUnit(name: string): string {
  if (name.includes("rate") || name.includes("pct")) return "%";
  if (name.includes("duration")) return "min";
  return "";
}

function percentileColor(pct: number): string {
  if (pct >= 75) return "text-green-500";
  if (pct >= 50) return "text-blue-500";
  if (pct >= 25) return "text-yellow-500";
  return "text-red-500";
}

export function BenchmarkView() {
  const [data, setData] = useState<{ opted_in: boolean; positions: BenchmarkPosition[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const fetchData = () => {
    apiFetch("/api/insights/benchmarks")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(fetchData, []);

  const toggleOptIn = async () => {
    if (!data) return;
    setToggling(true);
    try {
      await apiFetch("/api/insights/benchmarks/opt-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opt_in: !data.opted_in }),
      });
      fetchData();
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Team Benchmarks" description="Anonymous cross-org comparison" />
        <Skeleton className="h-[400px]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Team Benchmarks" description="See how your team's AI tool usage compares (anonymized, opt-in)">
        <button
          onClick={toggleOptIn}
          disabled={toggling}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            data?.opted_in
              ? "bg-destructive/15 text-destructive hover:bg-destructive/25"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          } disabled:opacity-50`}
        >
          {data?.opted_in ? "Opt Out" : "Opt In to Benchmarking"}
        </button>
      </PageHeader>

      {!data?.opted_in ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Opt in to anonymous benchmarking to see how your team's AI tool usage compares to other organizations.
              Only aggregate, team-level metrics are shared — no individual developer data.
            </p>
          </CardContent>
        </Card>
      ) : data.positions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Benchmark data will be available after the next weekly computation (Sunday midnight UTC).
              At least 3 organizations must participate for meaningful percentile bands.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.positions.map((pos) => (
            <Card key={pos.metric_name}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {metricLabel(pos.metric_name)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold">
                    {pos.value.toFixed(1)}{metricUnit(pos.metric_name)}
                  </span>
                  <span className={`text-sm font-medium ${percentileColor(pos.percentile)}`}>
                    {pos.percentile}th percentile
                  </span>
                </div>
                {/* Percentile bar */}
                <div className="mt-3 relative h-2 bg-muted rounded-full">
                  <div
                    className="absolute h-full bg-primary/30 rounded-full"
                    style={{ left: 0, width: "100%" }}
                  />
                  {/* Marker for org position */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full border-2 border-background"
                    style={{ left: `${Math.min(pos.percentile, 100)}%`, transform: "translate(-50%, -50%)" }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>P25: {pos.p25?.toFixed(1) ?? "—"}</span>
                  <span>P50: {pos.p50?.toFixed(1) ?? "—"}</span>
                  <span>P75: {pos.p75?.toFixed(1) ?? "—"}</span>
                  <span>P90: {pos.p90?.toFixed(1) ?? "—"}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
