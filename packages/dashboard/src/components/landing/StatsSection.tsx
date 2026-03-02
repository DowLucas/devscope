import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Separator } from "@/components/ui/separator";

/* ------------------------------------------------------------------ */
/*  StatsSection — Four key metrics displayed in a horizontal row      */
/*  Fetches live stats from /api/public/stats, falls back to static   */
/* ------------------------------------------------------------------ */

interface PublicStats {
  totalDevelopers: number;
  totalSessions: number;
  totalEvents: number;
  activeSessions: number;
}

interface Stat {
  value: string;
  label: string;
}

const FALLBACK_STATS: readonly Stat[] = [
  { value: "< 5 min", label: "Setup time" },
  { value: "0 ms", label: "Impact on workflow" },
  { value: "Real-time", label: "Event streaming" },
  { value: "Open Source", label: "Self-hostable" },
] as const;

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
}

function toLiveStats(data: PublicStats): Stat[] {
  return [
    { value: formatNumber(data.totalDevelopers), label: "Developers tracked" },
    { value: formatNumber(data.totalSessions), label: "Sessions monitored" },
    { value: formatNumber(data.totalEvents), label: "Events processed" },
    { value: String(data.activeSessions), label: "Active right now" },
  ];
}

/* ------------------------------------------------------------------ */
/*  Scroll-reveal animation config                                     */
/* ------------------------------------------------------------------ */

const revealInitial = { opacity: 0, y: 16 } as const;
const revealVisible = { opacity: 1, y: 0 } as const;
const revealViewport = { once: true, amount: 0.3 } as const;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function StatsSection() {
  const [stats, setStats] = useState<Stat[] | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchStats() {
      try {
        const res = await fetch("/api/public/stats");
        if (!res.ok) return;
        const data: PublicStats = await res.json();
        // Only show live stats if there's actual data
        const hasData = data.totalDevelopers > 0 || data.totalSessions > 0 || data.totalEvents > 0;
        if (active && hasData) setStats(toLiveStats(data));
      } catch {
        // Silently fall back to static copy
      }
    }

    fetchStats();
    const id = setInterval(fetchStats, 10_000);
    return () => { active = false; clearInterval(id); };
  }, []);

  const isLive = stats !== null;
  const displayStats = stats ?? FALLBACK_STATS;

  return (
    <section id="stats" className="py-16 px-4">
      <div className="max-w-4xl mx-auto">
        <Separator className="mb-12" />

        {/* Live badge — only shown when real data is loaded */}
        {isLive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center justify-center gap-2 mb-6"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
              <motion.span
                className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              />
              Live data
            </span>
          </motion.div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
          {displayStats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={revealInitial}
              whileInView={revealVisible}
              viewport={revealViewport}
              transition={{
                delay: index * 0.1,
                duration: 0.4,
                ease: "easeOut",
              }}
              className="text-center"
            >
              <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
                {stat.value}
              </div>
              <div className="text-sm text-muted-foreground mt-1 flex items-center justify-center gap-1.5">
                {/* Pulsing dot on "Active right now" */}
                {isLive && stat.label === "Active right now" && (
                  <motion.span
                    className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
                {stat.label}
              </div>
            </motion.div>
          ))}
        </div>

        <Separator className="mt-12" />
      </div>
    </section>
  );
}
