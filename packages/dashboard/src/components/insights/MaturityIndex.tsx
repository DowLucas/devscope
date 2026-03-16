import { useEffect, useState } from "react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { AiMaturitySnapshot } from "@devscope/shared";
import { ChartCard } from "./ChartCard";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";

function dimensionLabel(key: string): string {
  const labels: Record<string, string> = {
    tool_adoption: "Tool Adoption",
    workflow_efficiency: "Workflow Efficiency",
    failure_recovery: "Failure Recovery",
    skill_adoption: "Skill Adoption",
    ai_collaboration: "AI Collaboration",
  };
  return labels[key] ?? key;
}

export function MaturityIndex() {
  const [latest, setLatest] = useState<AiMaturitySnapshot | null>(null);
  const [history, setHistory] = useState<AiMaturitySnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch("/api/insights/maturity").then((r) => r.json()),
      apiFetch("/api/insights/maturity/history?days=90").then((r) => r.json()),
    ])
      .then(([latestData, historyData]) => {
        setLatest(latestData);
        setHistory(Array.isArray(historyData) ? historyData : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="AI Maturity Index" description="Team-level AI tooling maturity score" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-[400px]" />
          <Skeleton className="h-[400px]" />
        </div>
      </div>
    );
  }

  if (!latest) {
    return (
      <div className="space-y-6">
        <PageHeader title="AI Maturity Index" description="Team-level AI tooling maturity score" />
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            No maturity data yet. Snapshots are computed daily at midnight UTC.
          </p>
        </div>
      </div>
    );
  }

  const dimensions = latest.dimensions;
  const radarData = Object.entries(dimensions).map(([key, value]) => ({
    dimension: dimensionLabel(key),
    score: value,
    fullMark: 100,
  }));

  const trendData = [...history].reverse().map((s) => ({
    date: s.snapshot_date,
    score: s.overall_score,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="AI Maturity Index" description="Team-level AI tooling maturity score across 5 dimensions" />

      {/* Overall Score */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Overall Score</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="text-4xl font-bold">{latest.overall_score?.toFixed(1) ?? "—"}</div>
            <div className="text-sm text-muted-foreground">/ 100</div>
          </div>
          {latest.narrative && (
            <p className="text-sm text-muted-foreground mt-2">{latest.narrative}</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Radar Chart */}
        <ChartCard title="Dimension Breakdown" description="Score across 5 maturity dimensions">
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 12 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
              <Radar
                name="Score"
                dataKey="score"
                stroke="hsl(var(--primary))"
                fill="hsl(var(--primary))"
                fillOpacity={0.3}
              />
            </RadarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Trend Line */}
        <ChartCard title="Score Trend" description="Overall maturity score over time">
          {trendData.length > 1 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
              Not enough data points yet for a trend line
            </div>
          )}
        </ChartCard>
      </div>

      {/* Individual Dimension Scores */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {Object.entries(dimensions).map(([key, value]) => (
          <Card key={key}>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">{dimensionLabel(key)}</div>
              <div className="text-2xl font-semibold">{value.toFixed(0)}</div>
              <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.min(value, 100)}%` }}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
