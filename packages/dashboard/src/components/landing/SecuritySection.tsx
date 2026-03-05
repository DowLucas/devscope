import { Shield, Lock, UserCheck, EyeOff, ServerCrash, Key } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";

/* ------------------------------------------------------------------ */
/*  SecuritySection — highlights DevScope's security commitments       */
/* ------------------------------------------------------------------ */

interface Commitment {
  icon: LucideIcon;
  title: string;
  description: string;
}

const COMMITMENTS: Commitment[] = [
  {
    icon: EyeOff,
    title: "No individual surveillance",
    description:
      "Activity data surfaces team-wide patterns and tooling health — never individual rankings, comparisons, or productivity scores.",
  },
  {
    icon: UserCheck,
    title: "Consent-first collection",
    description:
      "Developers opt in by installing the plugin. Privacy mode is the default. Data collection is minimal and fully transparent.",
  },
  {
    icon: Key,
    title: "API key scoped access",
    description:
      "Each team uses scoped API keys. Keys are hashed at rest and can be revoked instantly from the dashboard.",
  },
  {
    icon: Lock,
    title: "Encrypted in transit",
    description:
      "All data travels over TLS. WebSocket connections are wss:// end-to-end. No plaintext event data ever leaves your machine unencrypted.",
  },
  {
    icon: ServerCrash,
    title: "Self-hostable",
    description:
      "Run DevScope on your own infrastructure. The full stack is open-source and ships as a single Docker Compose file.",
  },
  {
    icon: Shield,
    title: "Open source & auditable",
    description:
      "Every line of backend and dashboard code is public on GitHub. No black-box data pipelines — audit anything, anytime.",
  },
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
    <section id="security" className="py-24 px-4 relative overflow-hidden">
      {/* Subtle background gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center"
      >
        <div className="h-[480px] w-[680px] rounded-full bg-emerald-500/5 blur-3xl" />
      </div>

      <div className="max-w-5xl mx-auto">
        {/* Heading */}
        <motion.div
          initial={revealInitial}
          whileInView={revealVisible}
          viewport={revealViewport}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-center mb-14"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 mb-4">
            <Shield className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">
              Security &amp; Privacy
            </span>
          </div>

          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Built with trust at the core
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            DevScope handles real developer activity. We take that responsibility
            seriously — here's exactly how we protect your team's data.
          </p>
        </motion.div>

        {/* Commitment grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {COMMITMENTS.map((item, index) => (
            <CommitmentCard key={item.title} item={item} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Individual commitment card                                         */
/* ------------------------------------------------------------------ */

function CommitmentCard({ item, index }: { item: Commitment; index: number }) {
  const Icon = item.icon;

  return (
    <motion.div
      initial={revealInitial}
      whileInView={revealVisible}
      viewport={revealViewport}
      transition={{ delay: index * 0.07, duration: 0.45, ease: "easeOut" }}
      className="rounded-xl border border-border bg-card p-6 flex flex-col gap-3 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors duration-200"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        <Icon className="h-4.5 w-4.5 text-emerald-400" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">
          {item.title}
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {item.description}
        </p>
      </div>
    </motion.div>
  );
}
