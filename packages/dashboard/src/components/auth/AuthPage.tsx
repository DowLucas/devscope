import { useEffect } from "react";
import { motion } from "motion/react";
import { AuthView } from "@daveyplate/better-auth-ui";
import { Activity, GitBranch, Terminal, Zap } from "lucide-react";

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

/** Feature bullet items shown on the left panel. */
const FEATURES = [
  {
    icon: Activity,
    title: "Pattern discovery",
    desc: "Surface effective AI workflows and catch anti-patterns automatically.",
  },
  {
    icon: Terminal,
    title: "Zero-friction plugin",
    desc: "One command to install. Zero impact on developer workflow.",
  },
  {
    icon: GitBranch,
    title: "Skill development",
    desc: "Track how your AI development skills improve over time.",
  },
  {
    icon: Zap,
    title: "AI-powered suggestions",
    desc: "Get concrete tips to build better AI workflows from your session data.",
  },
] as const;

export function AuthPage({ view }: { view?: string }) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite");
    if (invite) {
      sessionStorage.setItem("devscope_invite_token", invite);
    }
  }, []);

  const isSignUp = view === "sign-up";

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
          className="relative z-10 flex items-center gap-2.5"
        >
          <div className="flex size-8 items-center justify-center rounded-lg bg-white/10 backdrop-blur-sm">
            <Activity className="size-4 text-blue-400" />
          </div>
          <span className="text-lg font-semibold tracking-tight">DevScope</span>
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
              Level up your team's AI development skills.{" "}
              <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
                Together.
              </span>
            </h2>
          </motion.div>

          <div className="flex flex-col gap-5">
            {FEATURES.map((f, i) => (
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
            "DevScope helped our team go from using AI haphazardly to having
            shared patterns and skills. Setup took two minutes."
          </p>
          <footer className="mt-2 text-xs text-white/40">
            — Engineering Manager
          </footer>
        </motion.blockquote>
      </div>

      {/* ================================================================ */}
      {/* RIGHT PANEL — Auth form                                          */}
      {/* ================================================================ */}
      <div className="flex flex-col items-center justify-center bg-background p-6 md:p-10">
        {/* Mobile-only logo (visible below lg) */}
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
            <Activity className="size-4 text-primary" />
          </div>
          <span className="text-lg font-semibold tracking-tight">DevScope</span>
        </div>

        <div className="w-full max-w-sm">
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
          <AuthView pathname={view || "sign-in"} />

          {/* Footer links */}
          <p className="mt-6 text-center text-xs text-muted-foreground">
            By continuing, you agree to our{" "}
            <a href="/terms" className="underline underline-offset-4 hover:text-foreground transition-colors">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/privacy" className="underline underline-offset-4 hover:text-foreground transition-colors">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
