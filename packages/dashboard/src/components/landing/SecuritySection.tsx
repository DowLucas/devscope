import { Lock, Shield, Trash2, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { Backdrop } from "./Backdrop";

/* ------------------------------------------------------------------ */
/*  SecuritySection — what developers control, in plain words.          */
/*  The exact switches live in the FAQ ("How do I opt out?").           */
/* ------------------------------------------------------------------ */

interface PrivacyPromise {
  icon: LucideIcon;
  title: string;
  description: string;
}

const PROMISES: PrivacyPromise[] = [
  {
    icon: Lock,
    title: "Private mode",
    description:
      "Keep prompts and replies on your machine. Only tool names and timings are sent.",
  },
  {
    icon: Users,
    title: "Sharing is off by default",
    description:
      "Teammates see that you're active, nothing more, until you choose to share.",
  },
  {
    icon: Trash2,
    title: "Export or delete anytime",
    description:
      "Ask for your data or have it removed. Old events expire on their own.",
  },
];

const TRUST = [
  "No rankings or productivity scores",
  "Open source",
  "Self-hostable",
  "Encrypted in transit",
];

/* ------------------------------------------------------------------ */
/*  Animation config                                                   */
/* ------------------------------------------------------------------ */

const revealInitial = { opacity: 0, y: 24 } as const;
const revealVisible = { opacity: 1, y: 0 } as const;
const revealViewport = { once: true, amount: 0.15 } as const;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SecuritySection() {
  return (
    <section id="security" className="py-24 px-4 relative isolate overflow-hidden">
      <Backdrop glows={[{ color: "green", at: "50% 50%", size: "45% 55%", opacity: 0.07 }]} />

      <div className="max-w-5xl mx-auto">
        {/* Heading */}
        <motion.div
          initial={revealInitial}
          whileInView={revealVisible}
          viewport={revealViewport}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 mb-4">
            <Shield className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">
              Privacy
            </span>
          </div>

          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-balance text-foreground">
            You decide what's shared
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Every kind of sharing has an off switch.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {PROMISES.map((item, index) => (
            <PromiseCard key={item.title} item={item} index={index} />
          ))}
        </div>

        <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {TRUST.map((t) => (
            <li key={t} className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-emerald-400" />
              {t}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Individual card                                                    */
/* ------------------------------------------------------------------ */

function PromiseCard({ item, index }: { item: PrivacyPromise; index: number }) {
  const Icon = item.icon;

  return (
    <motion.div
      initial={revealInitial}
      whileInView={revealVisible}
      viewport={revealViewport}
      transition={{ delay: index * 0.07, duration: 0.45, ease: "easeOut" }}
      className="rounded-xl border border-border bg-card p-6 flex flex-col gap-3"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        <Icon className="h-5 w-5 text-emerald-400" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">{item.title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
      </div>
    </motion.div>
  );
}
