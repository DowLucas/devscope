import { motion } from "motion/react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { usePersona } from "./PersonaContext";
import { getHeroContent } from "./personaContent";
import { brandify } from "./ClaudeBrand";
import { MockupActivityFeed } from "./MockupActivityFeed";
import { MockupTeamDashboard } from "./MockupTeamDashboard";

/* ------------------------------------------------------------------ */
/*  HeroSection — Top-of-page hero for the DevScope marketing site    */
/*  Content adapts based on selected persona (technical / non-tech)   */
/* ------------------------------------------------------------------ */

/** Shared entrance animation — each child staggers by its `custom` index. */
const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.12, duration: 0.5, ease: "easeOut" as const },
  }),
};

/** Fallback content used before persona is chosen. */
const DEFAULT = {
  badge: "Open Source AI Upskilling Platform",
  headline: "Help your team master AI-assisted development.",
  headlineAccent: "Together.",
  subtext:
    "DevScope surfaces patterns in how your team uses Claude Code — revealing effective workflows to share, anti-patterns to avoid, and skills to develop. Turn every session into a learning opportunity.",
};

export function HeroSection() {
  const { persona } = usePersona();
  const c = persona ? getHeroContent(persona) : DEFAULT;

  return (
    <section
      id="hero"
      className="relative overflow-hidden py-24 md:py-32 px-4"
    >
      {/* ---- Background glow ---- */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,oklch(0.488_0.243_264.376/0.15),transparent_70%)]"
      />

      {/* ---- Content container ---- */}
      <div className="relative mx-auto max-w-6xl flex flex-col items-center text-center gap-8">
        {/* ---- Badge ---- */}
        <motion.div
          variants={fadeUp}
          initial="initial"
          animate="animate"
          custom={0}
        >
          <Badge variant="outline" className="text-sm px-3 py-1">
            {c.badge}
          </Badge>
        </motion.div>

        {/* ---- Headline ---- */}
        <motion.h1
          variants={fadeUp}
          initial="initial"
          animate="animate"
          custom={1}
          className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl"
        >
          {brandify(c.headline)}{" "}
          <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
            {c.headlineAccent}
          </span>
        </motion.h1>

        {/* ---- Subtext ---- */}
        <motion.p
          variants={fadeUp}
          initial="initial"
          animate="animate"
          custom={2}
          className="max-w-2xl text-lg text-muted-foreground"
        >
          {brandify(c.subtext)}
        </motion.p>

        {/* ---- Call-to-action buttons ---- */}
        <motion.div
          variants={fadeUp}
          initial="initial"
          animate="animate"
          custom={3}
          className="flex flex-wrap items-center justify-center gap-4"
        >
          {/* Primary CTA */}
          <a
            href="/auth/sign-up"
            className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Get Started
          </a>

          {/* Secondary CTA — opens GitHub in a new tab */}
          <a
            href="https://github.com/DowLucas/devscope"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-6 py-3 text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            View on GitHub
            <ExternalLink className="size-4" />
          </a>
        </motion.div>

        {/* ---- Dashboard mockup placeholder ---- */}
        <motion.div
          variants={fadeUp}
          initial="initial"
          animate="animate"
          custom={4}
          className="mt-8 w-full max-w-4xl"
        >
          <div className="overflow-hidden rounded-xl border border-border shadow-2xl shadow-primary/5">
            {/* Fake window title bar */}
            <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-3">
              <span className="size-3 rounded-full bg-red-500" />
              <span className="size-3 rounded-full bg-yellow-500" />
              <span className="size-3 rounded-full bg-green-500" />
              <span className="ml-3 text-xs text-muted-foreground">
                DevScope —{" "}
                {persona === "non-technical"
                  ? "Team Dashboard"
                  : "Activity Feed"}
              </span>
            </div>

            {/* Dashboard mockup */}
            <div className="bg-gradient-to-b from-card to-background">
              {persona === "non-technical" ? (
                <MockupTeamDashboard />
              ) : (
                <MockupActivityFeed />
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
