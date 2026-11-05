import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CommandGroup, CommandScope, CommandSummary, CommandTrend } from "@devscope/shared";
import { useCommandsData } from "@/hooks/useCommandsData";
import { ButtonGroup, ButtonGroupItem } from "@/components/ui/button-group";
import { MetricCard } from "@/components/ui/metric-card";
import { ChartCard } from "@/components/insights/ChartCard";
import { AXIS_STYLE, GRID_STYLE } from "@/components/insights/charts/chartConfig";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatMs, percentChange } from "./format";

// One hue for both lines (p50 solid, p95 dashed): they are two levels of the
// same measure, so line style, the legend and the tooltip carry identity.
// --cmd-trend is set per theme in index.css (validated on both surfaces).
const TREND_COLOR = "var(--cmd-trend)";

/** Change in a duration: up is slower, so it reads as worse. */
function SlowerFaster({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">–</span>;
  if (Math.abs(value) < 5) {
    return (
      <span className="inline-flex items-center gap-0.5 text-muted-foreground">
        <Minus className="h-3 w-3" aria-hidden />
        <span>same</span>
      </span>
    );
  }
  const slower = value > 0;
  const Icon = slower ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 font-medium", slower ? "text-destructive" : "text-emerald-500")}
      title={slower ? "slower than the period before" : "faster than the period before"}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {slower ? "+" : ""}
      {value}% {slower ? "slower" : "faster"}
    </span>
  );
}

interface TrendTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ payload?: CommandTrend["points"][number] }>;
}

function TrendTooltip({ active, label, payload }: TrendTooltipProps) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium text-foreground">{String(label)}</p>
      {p.runs === 0 ? (
        <p className="text-muted-foreground">No runs</p>
      ) : (
        <>
          <p className="text-muted-foreground">
            Median: <span className="font-medium text-foreground">{formatMs(p.p50_ms)}</span>
          </p>
          <p className="text-muted-foreground">
            p95: <span className="font-medium text-foreground">{formatMs(p.p95_ms)}</span>
          </p>
          <p className="text-muted-foreground">
            Runs: <span className="font-medium text-foreground">{p.runs}</span>
            {p.failures > 0 && <> · failed {p.failures}</>}
          </p>
          <p className="text-muted-foreground">
            Waited: <span className="font-medium text-foreground">{formatMs(p.wait_ms)}</span>
          </p>
        </>
      )}
    </div>
  );
}

function LegendKey({ dashed, label }: { dashed?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <svg width="18" height="6" aria-hidden>
        <line x1="1" y1="3" x2="17" y2="3" stroke={TREND_COLOR} strokeWidth="2"
          strokeDasharray={dashed ? "4 3" : undefined} strokeLinecap="round" />
      </svg>
      {label}
    </span>
  );
}

interface CommandTimingsProps {
  days: number;
  /** Limit to one project (the project page); null for all projects. */
  project: string | null;
  /** More filters for the same row (the page's project and date pickers). */
  filters?: ReactNode;
}

/**
 * Which Bash commands the sessions wait on and whether they are getting
 * slower: totals, a table by time waited, and the trend of one command.
 */
export function CommandTimings({ days, project, filters }: CommandTimingsProps) {
  const [scope, setScope] = useState<CommandScope>("team");
  const [group, setGroup] = useState<CommandGroup>("signature");
  const [picked, setPicked] = useState<string | null>(null);

  const summary = useCommandsData<CommandSummary>("summary", { days, project, scope, group });
  const commands = summary.data?.commands ?? [];
  // The picked command, if it is still in the list, else the top one.
  const selected = commands.find((c) => c.command === picked)?.command ?? commands[0]?.command ?? null;
  const bucket = days > 60 ? "week" : "day";
  const trend = useCommandsData<CommandTrend>(
    "trend",
    { days, project, scope, group, command: selected, bucket },
    selected !== null,
  );

  const totals = summary.data?.totals;
  const runsDelta = totals ? percentChange(totals.runs, totals.prev_runs) : null;
  const waitDelta = totals ? percentChange(totals.wait_ms, totals.prev_wait_ms) : null;
  const moved = totals?.moved_runs ?? 0;
  const failures = totals?.failures ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <ButtonGroup>
          <ButtonGroupItem active={scope === "team"} onClick={() => setScope("team")}>Team</ButtonGroupItem>
          <ButtonGroupItem active={scope === "me"} onClick={() => setScope("me")}>You</ButtonGroupItem>
        </ButtonGroup>
        <ButtonGroup>
          <ButtonGroupItem active={group === "signature"} onClick={() => setGroup("signature")}>Commands</ButtonGroupItem>
          <ButtonGroupItem active={group === "program"} onClick={() => setGroup("program")}>Programs</ButtonGroupItem>
        </ButtonGroup>
        {filters}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Time spent waiting on commands"
          value={formatMs(totals?.wait_ms ?? 0)}
          previousValue={totals && totals.prev_wait_ms > 0 ? formatMs(totals.prev_wait_ms) : undefined}
        />
        <MetricCard
          label="Commands run"
          value={(totals?.runs ?? 0).toLocaleString()}
          previousValue={totals && totals.prev_runs > 0 ? totals.prev_runs.toLocaleString() : undefined}
          delta={runsDelta ?? undefined}
        />
        <MetricCard label="Hit the timeout (moved to background)" value={moved.toLocaleString()} />
        <MetricCard label="Failed" value={failures.toLocaleString()} />
      </div>
      {waitDelta !== null && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Waiting time vs the {days} days before: <SlowerFaster value={waitDelta} />
        </p>
      )}

      <ChartCard
        title="Commands by time waited"
        description={`Last ${days} days. Duration is start to finish; waited is how long the session was blocked on it.`}
        loading={summary.loading}
      >
        {commands.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No Bash commands recorded{project ? " for this project" : ""} in this period.
          </div>
        ) : (
          // w-0 min-w-full: the table scrolls inside the card instead of
          // widening the page on narrow screens.
          <div className="max-h-[480px] w-0 min-w-full overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Command</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Median</TableHead>
                  <TableHead className="text-right">p95</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead className="text-right">Waited</TableHead>
                  <TableHead className="text-right">Median vs before</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commands.map((c) => (
                  <TableRow
                    key={c.command}
                    onClick={() => setPicked(c.command)}
                    className={cn("cursor-pointer", c.command === selected && "bg-accent/60")}
                    aria-selected={c.command === selected}
                  >
                    <TableCell className="font-mono text-xs">
                      {c.command}
                      {c.background_runs > 0 && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground">
                          {c.background_runs} bg
                        </span>
                      )}
                      {c.running > 0 && (
                        <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground"
                          title="Background runs not reported as finished">
                          {c.running} unfinished
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.runs}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMs(c.p50_ms)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMs(c.p95_ms)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMs(c.max_ms)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatMs(c.wait_ms)}</TableCell>
                    <TableCell className="text-right text-xs">
                      <SlowerFaster value={c.prev_runs >= 3 ? percentChange(c.p50_ms, c.prev_p50_ms) : null} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.failures > 0 ? `${Math.round((c.failures / c.runs) * 100)}%` : "–"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ChartCard>

      {selected && (
        <ChartCard
          title={`${selected}: duration per ${bucket}`}
          description="Pick a command in the table to see its trend."
          loading={trend.loading}
          action={
            <div className="flex items-center gap-3">
              <LegendKey label="Median" />
              <LegendKey dashed label="p95" />
            </div>
          }
        >
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trend.data?.points ?? []} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid {...GRID_STYLE} vertical={false} />
              <XAxis dataKey="bucket" {...AXIS_STYLE} tickFormatter={(v: string) => v.slice(5)} minTickGap={24} />
              <YAxis {...AXIS_STYLE} width={64} tickFormatter={(v: number) => formatMs(v)} />
              <Tooltip content={TrendTooltip} cursor={{ stroke: "var(--border)", strokeWidth: 1 }} />
              <Line type="monotone" dataKey="p50_ms" name="Median" stroke={TREND_COLOR} strokeWidth={2}
                dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="p95_ms" name="p95" stroke={TREND_COLOR} strokeWidth={2}
                strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  );
}
