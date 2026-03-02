import { Users, UserPlus, Key, Terminal, CheckCircle2, Copy, BarChart3, Send } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Card, CardContent } from "@/components/ui/card";
import { usePersona } from "./PersonaContext";

/* ------------------------------------------------------------------ */
/*  HowItWorksSection — Persona-aware onboarding preview               */
/*  Developer view: personal setup flow                                */
/*  Manager view: team rollout flow                                    */
/* ------------------------------------------------------------------ */

interface Step {
  number: number;
  icon: LucideIcon;
  title: string;
  description: string;
  detail: ReactNode;
}

const SETUP_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/DowLucas/devscope-plugin/main/install.sh | bash";

/* ---- Developer (technical) steps --------------------------------- */

const DEVELOPER_STEPS: Step[] = [
  {
    number: 1,
    icon: Key,
    title: "Sign up and grab your API key",
    description: "Create an account, and generate an API key with one click.",
    detail: (
      <div className="rounded-md border border-border bg-muted/50 px-3 py-2 flex items-center gap-2">
        <code className="text-xs font-mono text-muted-foreground flex-1 truncate">
          dsk_a1b2c3d4e5f6...
        </code>
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    ),
  },
  {
    number: 2,
    icon: Terminal,
    title: "Run the setup",
    description: "One command. Paste your server URL and API key when prompted.",
    detail: (
      <div className="space-y-2">
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2 flex items-start gap-2">
          <span className="text-xs text-muted-foreground select-none">$</span>
          <code className="text-xs font-mono break-all leading-relaxed">
            {SETUP_COMMAND}
          </code>
        </div>
        <p className="text-xs text-muted-foreground">
          Non-blocking hooks — zero impact on your Claude Code sessions.
        </p>
      </div>
    ),
  },
  {
    number: 3,
    icon: CheckCircle2,
    title: "You're live",
    description: "Start a Claude Code session and your activity streams to the dashboard instantly.",
    detail: (
      <div className="flex items-center gap-2">
        <motion.span
          className="inline-block h-2 w-2 rounded-full bg-emerald-400"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
        <span className="text-xs text-emerald-400">Connection verified — events streaming</span>
      </div>
    ),
  },
];

/* ---- Manager (non-technical) steps ------------------------------- */

const MANAGER_STEPS: Step[] = [
  {
    number: 1,
    icon: Users,
    title: "Create your team",
    description: "Sign up and name your organization. Takes 10 seconds.",
    detail: (
      <div className="space-y-2">
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Team name:</span>
            <span className="text-sm font-mono">My Company</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    number: 2,
    icon: UserPlus,
    title: "Invite your developers",
    description: "Send email invites from the dashboard. They join with one click.",
    detail: (
      <div className="space-y-2">
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground flex-1">alice@company.com</span>
          <Send className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <p className="text-xs text-muted-foreground">
          Developers install the plugin themselves — no IT ticket needed.
        </p>
      </div>
    ),
  },
  {
    number: 3,
    icon: Terminal,
    title: "Developers run the setup",
    description: "Each developer runs one command. Non-blocking, zero workflow disruption.",
    detail: (
      <div className="rounded-md border border-border bg-muted/50 px-3 py-2 flex items-start gap-2">
        <span className="text-xs text-muted-foreground select-none">$</span>
        <code className="text-xs font-mono break-all leading-relaxed">
          {SETUP_COMMAND}
        </code>
      </div>
    ),
  },
  {
    number: 4,
    icon: BarChart3,
    title: "See your team's activity",
    description: "Sessions stream in as your team works. Metrics, alerts, and AI briefings — all automatic.",
    detail: (
      <div className="flex items-center gap-2">
        <motion.span
          className="inline-block h-2 w-2 rounded-full bg-emerald-400"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
        <span className="text-xs text-emerald-400">4 developers connected — 12 sessions today</span>
      </div>
    ),
  },
];

/* ---- Default steps (before persona selected) --------------------- */

const DEFAULT_STEPS = DEVELOPER_STEPS;

/* ------------------------------------------------------------------ */
/*  Headings per persona                                               */
/* ------------------------------------------------------------------ */

const HEADINGS = {
  technical: {
    title: "Three steps. That's it.",
    subtitle: "No config files, no YAML. Just run the setup and go.",
  },
  "non-technical": {
    title: "Roll out to your team in under 5 minutes",
    subtitle: "Four steps from sign-up to full team visibility. No infrastructure to manage.",
  },
  default: {
    title: "Up and running in under 5 minutes",
    subtitle: "No config files, no YAML, no infrastructure to manage.",
  },
};

/* ------------------------------------------------------------------ */
/*  Scroll-reveal animation config                                     */
/* ------------------------------------------------------------------ */

const revealInitial = { opacity: 0, y: 24 } as const;
const revealVisible = { opacity: 1, y: 0 } as const;
const revealViewport = { once: true, amount: 0.2 } as const;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function HowItWorksSection() {
  const { persona } = usePersona();

  const steps = persona === "non-technical"
    ? MANAGER_STEPS
    : persona === "technical"
      ? DEVELOPER_STEPS
      : DEFAULT_STEPS;

  const heading = persona
    ? HEADINGS[persona]
    : HEADINGS.default;

  return (
    <section id="how-it-works" className="py-24 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Heading */}
        <motion.div
          initial={revealInitial}
          whileInView={revealVisible}
          viewport={revealViewport}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            {heading.title}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            {heading.subtitle}
          </p>
        </motion.div>

        {/* Step cards */}
        <div className="space-y-4">
          {steps.map((step, index) => (
            <StepCard key={step.number} step={step} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Individual step card                                               */
/* ------------------------------------------------------------------ */

function StepCard({ step, index }: { step: Step; index: number }) {
  const Icon = step.icon;

  return (
    <motion.div
      initial={revealInitial}
      whileInView={revealVisible}
      viewport={revealViewport}
      transition={{ delay: index * 0.1, duration: 0.45, ease: "easeOut" }}
    >
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            {/* Step number */}
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium mt-0.5">
              {step.number}
            </div>

            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-base font-semibold text-foreground">
                  {step.title}
                </h3>
              </div>
              <p className="text-sm text-muted-foreground">
                {step.description}
              </p>
            </div>
          </div>

          {/* Detail mockup */}
          <div className="ml-10">
            {step.detail}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
