import { motion } from "motion/react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle,
  FileText,
  MessageSquareText,
  TrendingDown,
  Wand2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Team view mockup for the landing page (team-lead persona).          */
/*  Everything here is aggregate and about tools, projects and shared   */
/*  know-how, never about individual developers (see CLAUDE.md ethics). */
/* ------------------------------------------------------------------ */

const STATS = [
  { label: "Sessions this week", value: "142", note: null },
  { label: "Tool failure rate", value: "4.1%", note: "↓ 0.8 pts" },
  { label: "Team skill runs", value: "38", note: "↑ 12" },
] as const;

const FRICTION = [
  {
    icon: AlertTriangle,
    iconColor: "text-amber-400",
    title: "pnpm test times out in web-app",
    detail: "12 Bash failures across 5 sessions. The team playbook suggests --runInBand.",
    tag: "Tooling",
    tagClass: "border border-amber-500/30 text-amber-400",
  },
  {
    icon: TrendingDown,
    iconColor: "text-emerald-400",
    title: "Fewer failures in api-service",
    detail: "Down 30% since its CLAUDE.md gained a section on the test database.",
    tag: "CLAUDE.md",
    tagClass: "bg-muted text-muted-foreground",
  },
] as const;

const SPREADING = [
  { icon: Wand2, label: "release-notes", kind: "Team skill", count: "9 sessions" },
  { icon: MessageSquareText, label: "run the e2e suite first", kind: "Prompt", count: "6 sessions" },
  { icon: BookOpen, label: "Fixing flaky Playwright tests", kind: "Playbook", count: "4 sessions" },
] as const;

const REPORTS = [
  { title: "Weekly Team Digest", time: "2h ago" },
  { title: "Tooling Health Report", time: "1d ago" },
] as const;

export function MockupTeamDashboard() {
  return (
    <div className="px-5 py-4 space-y-4 text-left">
      {/* Scope line: says out loud that this is aggregate */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">This week across the team</span>
        <span className="text-xs text-muted-foreground">
          Aggregate · 8 developers, 5 sharing details
        </span>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-semibold text-foreground">{s.value}</span>
              {s.note ? <span className="text-[10px] text-emerald-400">{s.note}</span> : null}
            </div>
          </div>
        ))}
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Waiting on someone</div>
          <div className="flex items-center gap-1.5">
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-orange-400"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <span className="text-lg font-semibold text-foreground">2</span>
            <span className="text-[10px] text-muted-foreground">sessions now</span>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[3fr_2fr]">
        {/* Tooling friction */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Where the team gets stuck</div>
          {FRICTION.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
                <Icon className={`mt-0.5 size-4 shrink-0 ${f.iconColor}`} />
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{f.title}</span>
                    <span className={`shrink-0 rounded px-1.5 text-[10px] ${f.tagClass}`}>{f.tag}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{f.detail}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Shared know-how */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">What's spreading</div>
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {SPREADING.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="flex items-center gap-2.5 px-3 py-2">
                  <Icon className="size-3.5 shrink-0 text-violet-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground">{s.label}</div>
                    <div className="text-[10px] text-muted-foreground">{s.kind}</div>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{s.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Reports */}
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="size-3.5 text-muted-foreground" />
        {REPORTS.map((r) => (
          <span
            key={r.title}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-foreground"
          >
            <CheckCircle className="size-3 text-emerald-500" />
            {r.title}
            <span className="text-muted-foreground">· {r.time}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
