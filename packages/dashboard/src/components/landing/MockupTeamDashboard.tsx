import { TrendingUp } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Static team dashboard mockup for the landing page (non-technical)  */
/* ------------------------------------------------------------------ */

const METRICS = [
  { label: "Sessions", value: "142", delta: "+12%" },
  { label: "Prompts", value: "1.8K", delta: "+8%" },
  { label: "Tool Calls", value: "4.2K", delta: "+15%" },
] as const;

const DEVELOPERS = [
  { name: "Lucas S", active: true, sessions: 28, bars: [3, 5, 4, 7, 6, 8, 5] },
  { name: "Sarah K", active: true, sessions: 34, bars: [6, 4, 7, 5, 8, 6, 7] },
  { name: "Alex M", active: false, sessions: 19, bars: [4, 3, 2, 5, 3, 1, 2] },
  { name: "Jordan P", active: true, sessions: 41, bars: [7, 8, 6, 9, 7, 8, 9] },
] as const;

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function MockupTeamDashboard() {
  return (
    <div className="px-4 py-3 space-y-3">
      {/* Metric cards row */}
      <div className="grid grid-cols-3 gap-2">
        {METRICS.map((m) => (
          <div
            key={m.label}
            className="rounded-lg border border-border bg-card p-2.5"
          >
            <span className="text-[10px] text-muted-foreground">{m.label}</span>
            <div className="mt-1 text-lg font-bold tabular-nums">{m.value}</div>
            <div className="mt-0.5 flex items-center gap-1 text-emerald-400">
              <TrendingUp className="size-2.5" />
              <span className="text-[10px] font-medium">{m.delta}</span>
              <span className="text-[10px] text-muted-foreground">
                vs last week
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Developer cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {DEVELOPERS.map((dev) => (
          <div
            key={dev.name}
            className="rounded-lg border border-border bg-card p-2.5 flex flex-col items-center gap-1.5"
          >
            {/* Avatar with status ring */}
            <div className="relative">
              <div className="flex size-8 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                {getInitials(dev.name)}
              </div>
              <span
                className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card ${
                  dev.active ? "bg-emerald-500" : "bg-muted-foreground/40"
                }`}
              />
            </div>

            <span className="text-[11px] font-medium">{dev.name}</span>
            <span className="text-[10px] text-muted-foreground">
              {dev.sessions} sessions
            </span>

            {/* Activity sparkline */}
            <div className="flex items-end gap-px h-4 w-full justify-center">
              {dev.bars.map((h, i) => (
                <div
                  key={i}
                  className={`w-1.5 rounded-sm ${
                    dev.active ? "bg-emerald-500/60" : "bg-muted-foreground/20"
                  }`}
                  style={{ height: `${(h / 9) * 100}%` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
