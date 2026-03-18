import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { TeamToolTopology } from "@devscope/shared";

const PROFICIENCY_COLORS: Record<string, string> = {
  strong: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  developing: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  struggling: "bg-destructive/20 text-destructive border-destructive/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

const COVERAGE_LABELS: Record<string, string> = {
  widespread: "Widespread",
  partial: "Partial",
  narrow: "Narrow",
  unknown: "Unknown",
};

interface ToolGroup {
  tool_name: string;
  total_uses: number;
  unique_users: number;
  success_count: number;
  failure_count: number;
  failure_rate: number | null;
  proficiency_level: string;
  coverage_level: string;
  subcommands: TeamToolTopology[];
}

function groupByTool(data: TeamToolTopology[]): ToolGroup[] {
  const groups = new Map<string, TeamToolTopology[]>();
  for (const row of data) {
    const key = row.tool_name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const result: ToolGroup[] = [];
  for (const [tool_name, items] of groups) {
    const total_uses = items.reduce((s, r) => s + r.total_uses, 0);
    const success_count = items.reduce((s, r) => s + r.success_count, 0);
    const failure_count = items.reduce((s, r) => s + r.failure_count, 0);
    // Proxy: use max per-subcommand count since we can't deduplicate user IDs client-side
    const unique_users = Math.max(...items.map((r) => r.unique_users));
    const failure_rate = total_uses > 0 ? failure_count / total_uses : null;

    // Aggregate proficiency: worst across subcommands
    const levels = items.map((r) => r.proficiency_level);
    const proficiency_level = levels.includes("struggling")
      ? "struggling"
      : levels.includes("developing")
        ? "developing"
        : levels.includes("strong")
          ? "strong"
          : "unknown";

    const coverages = items.map((r) => r.coverage_level);
    const coverage_level = coverages.includes("widespread")
      ? "widespread"
      : coverages.includes("partial")
        ? "partial"
        : coverages.includes("narrow")
          ? "narrow"
          : "unknown";

    // Sort subcommands by usage desc
    const subcommands = items
      .filter((r) => r.tool_subcommand)
      .sort((a, b) => b.total_uses - a.total_uses);

    result.push({
      tool_name,
      total_uses,
      unique_users,
      success_count,
      failure_count,
      failure_rate,
      proficiency_level,
      coverage_level,
      subcommands,
    });
  }

  return result.sort((a, b) => b.total_uses - a.total_uses);
}

interface Props {
  data: TeamToolTopology[];
  loading: boolean;
}

export function ToolProficiencyGrid({ data, loading }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No tool usage data computed yet.
      </div>
    );
  }

  const groups = groupByTool(data);

  function toggleExpand(toolName: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(toolName)) next.delete(toolName);
      else next.add(toolName);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="grid grid-cols-[1fr_80px_80px_80px_100px] gap-2 px-3 text-xs font-medium text-muted-foreground">
        <span>Tool</span>
        <span className="text-right">Uses</span>
        <span className="text-right">Fail %</span>
        <span className="text-right">Users</span>
        <span className="text-right">Proficiency</span>
      </div>

      {groups.map((group) => {
        const hasSubcommands = group.subcommands.length > 0;
        const isExpanded = expanded.has(group.tool_name);

        return (
          <div key={group.tool_name}>
            {/* Parent tool row */}
            <div
              className={`grid grid-cols-[1fr_80px_80px_80px_100px] gap-2 items-center px-3 py-2 rounded-lg border ${PROFICIENCY_COLORS[group.proficiency_level]} ${hasSubcommands ? "cursor-pointer" : ""}`}
              onClick={() => hasSubcommands && toggleExpand(group.tool_name)}
            >
              <span className="text-sm font-medium truncate flex items-center gap-1.5">
                {hasSubcommands && (
                  isExpanded
                    ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    : <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
                {group.tool_name}
              </span>
              <span className="text-sm text-right">{group.total_uses}</span>
              <span className="text-sm text-right">
                {group.failure_rate != null ? `${(group.failure_rate * 100).toFixed(1)}%` : "—"}
              </span>
              <span className="text-sm text-right">{group.unique_users}</span>
              <span className="text-xs text-right capitalize">
                {group.proficiency_level} · {COVERAGE_LABELS[group.coverage_level]}
              </span>
            </div>

            {/* Subcommand rows */}
            {isExpanded && group.subcommands.map((sub) => (
              <div
                key={sub.id}
                className="grid grid-cols-[1fr_80px_80px_80px_100px] gap-2 items-center pl-9 pr-3 py-1.5 text-muted-foreground"
              >
                <span className="text-xs font-mono truncate">{sub.tool_subcommand}</span>
                <span className="text-xs text-right">{sub.total_uses}</span>
                <span className="text-xs text-right">
                  {sub.failure_rate != null ? `${(Number(sub.failure_rate) * 100).toFixed(1)}%` : "—"}
                </span>
                <span className="text-xs text-right">{sub.unique_users}</span>
                <span className="text-xs text-right capitalize">
                  {sub.proficiency_level} · {COVERAGE_LABELS[sub.coverage_level]}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
