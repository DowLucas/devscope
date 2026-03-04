import { useCallback, useEffect, useState } from "react";
import { Activity, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import type { ToolingHealthSummary } from "@devscope/shared";

function getRateColor(rate: number): string {
  if (rate < 10) return "text-emerald-400";
  if (rate < 30) return "text-amber-400";
  return "text-red-400";
}

function getRateBg(rate: number): string {
  if (rate < 10) return "bg-emerald-500/10";
  if (rate < 30) return "bg-amber-500/10";
  return "bg-red-500/10";
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "improving") return <TrendingDown className="h-3.5 w-3.5 text-emerald-400" />;
  if (trend === "degrading") return <TrendingUp className="h-3.5 w-3.5 text-red-400" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function ToolingHealthCard() {
  const [data, setData] = useState<ToolingHealthSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiFetch("/api/alerts/tooling-health?days=7");
      if (!res.ok) {
        setError(true);
        return;
      }
      const items: ToolingHealthSummary[] = await res.json();
      // Group by tool, pick highest failure rate per tool
      const byTool = new Map<string, ToolingHealthSummary>();
      for (const item of items) {
        const existing = byTool.get(item.tool_name);
        if (!existing || item.failure_rate > existing.failure_rate) {
          byTool.set(item.tool_name, item);
        }
      }
      setData(Array.from(byTool.values()).slice(0, 8));
    } catch (err) {
      console.error("[ToolingHealthCard]", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <Skeleton className="h-48 rounded-xl" />;
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Failed to load tooling health data.
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) return null;

  const degrading = data.filter((d) => d.trend === "degrading");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Tooling Health (7d)
          </CardTitle>
          {degrading.length > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {degrading.length} degrading
            </Badge>
          )}
        </div>
        <CardDescription>
          Tool failure rates across all projects. High rates indicate tooling issues, not developer issues.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {data.map((tool) => (
            <div
              key={`${tool.tool_name}-${tool.project_name ?? "all"}`}
              className={`rounded-lg p-3 ${getRateBg(tool.failure_rate)} transition-colors`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium truncate">{tool.tool_name}</span>
                <TrendIcon trend={tool.trend} />
              </div>
              <div className={`text-lg font-bold tabular-nums ${getRateColor(tool.failure_rate)}`}>
                {tool.failure_rate}%
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-muted-foreground">
                  {tool.total_calls} calls
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {tool.failure_count} fails
                </span>
              </div>
              {tool.project_name && (
                <span className="text-[10px] text-muted-foreground truncate block mt-0.5">
                  {tool.project_name}
                </span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
