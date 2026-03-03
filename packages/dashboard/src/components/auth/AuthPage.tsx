import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AuthView } from "@daveyplate/better-auth-ui";
import {
  Activity,
  GitBranch,
  Terminal,
  Zap,
  BarChart3,
  Sparkles,
  Shield,
  Users,
} from "lucide-react";
import logoFull from "@/assets/logo-full.png";

/* ------------------------------------------------------------------ */
/*  AuthPage — Dual-column authentication layout                       */
/*  Left: branded panel with feature highlights                        */
/*  Right: auth form (sign-in / sign-up via better-auth-ui)            */
/* ------------------------------------------------------------------ */

/** Staggered fade-up for left panel children. */
const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.15 + i * 0.1, duration: 0.5, ease: "easeOut" as const },
  }),
};

/** Feature bullet items — technical persona (developers). */
const TECHNICAL_FEATURES = [
  {
    icon: Activity,
    title: "Live session timeline",
    desc: "See every prompt, tool call, and agent spawn as it happens.",
  },
  {
    icon: Terminal,
    title: "Zero-friction setup",
    desc: "One command to install. Runs silently alongside Claude Code.",
  },
  {
    icon: GitBranch,
    title: "Session history & replay",
    desc: "Review past sessions to understand what worked and what didn't.",
  },
  {
    icon: Zap,
    title: "Stuck session alerts",
    desc: "Get notified when a session hits errors or stops making progress.",
  },
] as const;

/** Feature bullet items — non-technical persona (managers/leaders). */
const NON_TECHNICAL_FEATURES = [
  {
    icon: BarChart3,
    title: "Automated team reports",
    desc: "Weekly digests and sprint analyses generated from session data, ready for standup.",
  },
  {
    icon: Sparkles,
    title: "Actionable insights",
    desc: "Burnout risk alerts, pairing recommendations, and velocity trends.",
  },
  {
    icon: Users,
    title: "Team visibility at a glance",
    desc: "See who's active, what they're working on, and where they're stuck.",
  },
  {
    icon: Shield,
    title: "No developer disruption",
    desc: "Runs silently in the background. Your team won't even notice it.",
  },
] as const;

const HEADLINES = {
  technical: {
    text: "Full observability for your agentic engineering sessions. ",
    accent: "Every step.",
  },
  "non-technical": {
    text: "Understand your team's agentic engineering workflows. ",
    accent: "Without the noise.",
  },
} as const;

const QUOTES = {
  technical: {
    text: "I can finally see what Claude is actually doing across my sessions. It's like having a flight recorder for agentic engineering.",
    author: "— Senior Developer",
  },
  "non-technical": {
    text: "I used to have no idea what my team was doing with Claude. Now I get a weekly digest and can spot issues before they become problems.",
    author: "— Engineering Manager",
  },
} as const;

function readPersona(): "technical" | "non-technical" | null {
  try {
    const v = localStorage.getItem("devscope_persona");
    if (v === "technical" || v === "non-technical") return v;
  } catch { /* private browsing */ }
  return null;
}

export function AuthPage({ view }: { view?: string }) {
  const [persona, setPersona] = useState<"technical" | "non-technical" | null>(readPersona);

  useEffect(() => {
    // Re-read on storage changes (e.g. landing page footer switcher in another tab)
    const onStorage = () => setPersona(readPersona());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const isSignUp = view === "sign-up";
  const p = persona ?? "technical";
  const features = p === "non-technical" ? NON_TECHNICAL_FEATURES : TECHNICAL_FEATURES;
  const headline = HEADLINES[p];
  const quote = QUOTES[p];

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* ================================================================ */}
      {/* LEFT PANEL — Brand + features (hidden on mobile)                 */}
      {/* ================================================================ */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-zinc-950 p-10 text-white">
        {/* Gradient background mesh */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,oklch(0.488_0.243_264.376/0.20),transparent_60%),radial-gradient(ellipse_at_70%_80%,oklch(0.627_0.265_303.9/0.12),transparent_50%)]"
        />
        {/* Subtle dot pattern */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        {/* Top — Logo */}
        <motion.div
          variants={fadeUp}
          initial="initial"
          animate="animate"
          custom={0}
          className="relative z-10"
        >
          <a href="/">
            <img src={logoFull} alt="DevScope" className="h-6" />
          </a>
        </motion.div>

        {/* Middle — Headline + features */}
        <div className="relative z-10 flex flex-col gap-8">
          <motion.div
            variants={fadeUp}
            initial="initial"
            animate="animate"
            custom={1}
          >
            <h2 className="max-w-sm text-3xl font-bold leading-snug tracking-tight">
              {headline.text}
              <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
                {headline.accent}
              </span>
            </h2>
          </motion.div>

          <div className="flex flex-col gap-5">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                variants={fadeUp}
                initial="initial"
                animate="animate"
                custom={i + 2}
                className="flex items-start gap-3"
              >
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-white/[0.06] ring-1 ring-white/[0.08]">
                  <f.icon className="size-4 text-blue-400/80" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white/90">{f.title}</p>
                  <p className="text-sm text-white/50">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Bottom — Testimonial / social proof */}
        <motion.blockquote
          variants={fadeUp}
          initial="initial"
          animate="animate"
          custom={7}
          className="relative z-10 border-l-2 border-white/10 pl-4"
        >
          <p className="text-sm leading-relaxed text-white/60">
            "{quote.text}"
          </p>
          <footer className="mt-2 text-xs text-white/40">
            {quote.author}
          </footer>
        </motion.blockquote>
      </div>

      {/* ================================================================ */}
      {/* RIGHT PANEL — Auth form                                          */}
      {/* ================================================================ */}
      <div className="flex flex-col items-center justify-center bg-background p-6 md:p-10">
        {/* Mobile-only logo (visible below lg) */}
        <div className="mb-8 lg:hidden">
          <img src={logoFull} alt="DevScope" className="h-6" />
        </div>

        <div className="w-full max-w-lg mx-auto">
          {/* Heading */}
          <div className="mb-6 text-center lg:text-left">
            <h1 className="text-2xl font-bold tracking-tight">
              {isSignUp ? "Create your account" : "Welcome back"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isSignUp
                ? "Get started with DevScope in minutes"
                : "Sign in to your DevScope account"}
            </p>
          </div>

          {/* Auth form from better-auth-ui */}
          <AuthView pathname={view || "sign-in"} className="max-w-lg" />
        </div>
      </div>
    </div>
  );
}
