import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "../ChartCard";
import { ChartTooltip } from "./ChartTooltip";
import { AXIS_STYLE, GRID_STYLE } from "./chartConfig";
import { apiFetch } from "@/lib/api";

interface PillarRow {
  week: string;
  intent: string;
  session_count: number;
  total_minutes: number;
}

const INTENT_ORDER = [
  "build",
  "debug",
  "refactor",
  "review",
  "doc",
  "exploration",
  "tooling",
  "other",
  "unclassified",
] as const;

const INTENT_COLORS: Record<string, string> = {
  build: "oklch(0.696 0.17 162.48)",
  debug: "oklch(0.645 0.246 16.439)",
  refactor: "oklch(0.769 0.188 70.08)",
  review: "oklch(0.488 0.243 264.376)",
  doc: "oklch(0.627 0.265 303.9)",
  exploration: "oklch(0.65 0.18 220)",
  tooling: "oklch(0.7 0.12 60)",
  other: "oklch(0.55 0.05 260)",
  unclassified: "oklch(0.45 0 0)",
};

const INTENT_LABEL: Record<string, string> = {
  build: "Build",
  debug: "Debug",
  refactor: "Refactor",
  review: "Review",
  doc: "Docs",
  exploration: "Exploration",
  tooling: "Tooling",
  other: "Other",
  unclassified: "Unclassified",
};

type Mode = "sessions" | "minutes";

type Pivoted = { week: string } & Record<string, number | string>;

function pivot(rows: PillarRow[], mode: Mode) {
  const byWeek = new Map<string, Record<string, number>>();
  const intents = new Set<string>();
  for (const r of rows) {
    intents.add(r.intent);
    const bucket = byWeek.get(r.week) ?? {};
    const v = mode === "sessions" ? r.session_count : Math.round(r.total_minutes);
    bucket[r.intent] = (bucket[r.intent] ?? 0) + v;
    byWeek.set(r.week, bucket);
  }
  const data: Pivoted[] = Array.from(byWeek.entries())
    .map(([week, vals]) => ({ week, ...vals }))
    .sort((a, b) => a.week.localeCompare(b.week));
  const orderedIntents = INTENT_ORDER.filter((i) => intents.has(i));
  return { data, intents: orderedIntents };
}

export function ContributionPillarsChart({ weeks = 12 }: { weeks?: number }) {
  const [rows, setRows] = useState<PillarRow[] | null>(null);
  const [loadedWeeks, setLoadedWeeks] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("sessions");
  const loading = loadedWeeks !== weeks;

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/insights/pillars?weeks=${weeks}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setRows(Array.isArray(data) ? (data as PillarRow[]) : []);
        setLoadedWeeks(weeks);
      })
      .catch(() => {
        if (!cancelled) setLoadedWeeks(weeks);
      });
    return () => {
      cancelled = true;
    };
  }, [weeks]);

  const { data, intents } = useMemo(
    () => pivot(rows ?? [], mode),
    [rows, mode],
  );

  const isEmpty = !loading && data.length === 0;

  return (
    <ChartCard
      title="Contribution Pillars"
      description="How the team is spending Claude Code time. Aggregated across the team — individual breakdowns are not available by design."
      loading={loading}
      action={
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode("sessions")}
            className={`rounded px-2 py-0.5 ${
              mode === "sessions"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground"
            }`}
          >
            Sessions
          </button>
          <button
            type="button"
            onClick={() => setMode("minutes")}
            className={`rounded px-2 py-0.5 ${
              mode === "minutes"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground"
            }`}
          >
            Minutes
          </button>
        </div>
      }
    >
      {isEmpty ? (
        <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
          No session data in the last {weeks} weeks.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="week" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={ChartTooltip} />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value: string) => INTENT_LABEL[value] ?? value}
            />
            {intents.map((intent, idx) => (
              <Bar
                key={intent}
                dataKey={intent}
                name={intent}
                stackId="a"
                fill={INTENT_COLORS[intent] ?? "oklch(0.5 0 0)"}
                radius={
                  idx === intents.length - 1
                    ? [4, 4, 0, 0]
                    : [0, 0, 0, 0]
                }
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
