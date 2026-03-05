import { useEffect, useRef, useState } from "react";
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
    title: "Pattern discovery",
    desc: "Surface effective AI workflows and catch anti-patterns automatically.",
  },
  {
    icon: Terminal,
    title: "Zero-friction setup",
    desc: "One command to install. Runs silently alongside Claude Code.",
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

/* ------------------------------------------------------------------ */
/*  WaitlistForm — shown on /auth/sign-up when registration is closed  */
/* ------------------------------------------------------------------ */
function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error" | "duplicate">("idle");
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch("/api/public/waitlist/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-requested-with": "fetch" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }),
      });
      if (res.ok) {
        setStatus("success");
      } else if (res.status === 409) {
        setStatus("duplicate");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="text-center space-y-3">
        <div className="text-3xl">🎉</div>
        <h2 className="text-xl font-semibold">You're on the list!</h2>
        <p className="text-sm text-muted-foreground">
          We'll notify you at <span className="font-medium">{email}</span> when a spot opens up.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          DevScope is currently at capacity. Join the waitlist and we'll reach out when space opens up.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="wl-name" className="text-sm font-medium">Name <span className="text-muted-foreground">(optional)</span></label>
          <input
            id="wl-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="wl-email" className="text-sm font-medium">Email</label>
          <input
            id="wl-email"
            ref={emailRef}
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {status === "duplicate" && (
          <p className="text-sm text-amber-500">You're already on the waitlist.</p>
        )}
        {status === "error" && (
          <p className="text-sm text-destructive">Something went wrong. Please try again.</p>
        )}
        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === "loading" ? "Joining…" : "Join the waitlist"}
        </button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <a href="/auth/sign-in" className="underline underline-offset-4 hover:text-foreground">Sign in</a>
      </p>
    </div>
  );
}

export function AuthPage({ view }: { view?: string }) {
  const [persona, setPersona] = useState<"technical" | "non-technical" | null>(readPersona);
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null);

  useEffect(() => {
    // Re-read on storage changes (e.g. landing page footer switcher in another tab)
    const onStorage = () => setPersona(readPersona());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (view !== "sign-up") return;
    fetch("/api/public/registration-status")
      .then(r => r.json())
      .then((d: { open: boolean }) => setRegistrationOpen(d.open))
      .catch(() => setRegistrationOpen(true)); // fail open
  }, [view]);

  const isSignUp = view === "sign-up";
  const p = persona ?? "technical";
  const features = p === "non-technical" ? NON_TECHNICAL_FEATURES : TECHNICAL_FEATURES;
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
              Level up your team's AI development skills.{" "}
              <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
                Together.
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
            "DevScope helped our team go from using AI haphazardly to having
            shared patterns and skills. Setup took two minutes."
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
              {isSignUp && registrationOpen === false
                ? "Join the waitlist"
                : isSignUp
                ? "Create your account"
                : "Welcome back"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isSignUp && registrationOpen === false
                ? "We're at capacity — get notified when a spot opens"
                : isSignUp
                ? "Get started with DevScope in minutes"
                : "Sign in to your DevScope account"}
            </p>
          </div>

          {/* Show waitlist form when registration is closed, otherwise auth form */}
          {isSignUp && registrationOpen === false ? (
            <WaitlistForm />
          ) : (
            <AuthView pathname={view || "sign-in"} className="max-w-lg" />
          )}
        </div>
      </div>
    </div>
  );
}
