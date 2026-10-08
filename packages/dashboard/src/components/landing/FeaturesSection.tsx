import type { LucideIcon } from "lucide-react";
import {
  History,
  Network,
  Search,
  Terminal,
  Users,
  Volume2,
} from "lucide-react";
import { motion } from "motion/react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { usePersona } from "./PersonaContext";
import { getFeaturesContent, type FeatureItem } from "./personaContent";
import { brandify } from "./ClaudeBrand";
import { Backdrop } from "./Backdrop";

/* -------------------------------------------------------------------------- */
/*  Fallback features (shown before persona is selected)                       */
/* -------------------------------------------------------------------------- */

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const DEFAULT_FEATURES: readonly Feature[] = [
  {
    icon: History,
    title: "Recall what worked",
    description:
      "Hit an error or ask something you've asked before, and DevScope shows what fixed it last time.",
  },
  {
    icon: Search,
    title: "Search every session",
    description:
      "Find any past prompt or reply by meaning, not just keywords, and jump straight to that turn.",
  },
  {
    icon: Users,
    title: "Team habits, shared",
    description:
      "Prompts and skills that worked for your team show up as suggestions while you work.",
  },
  {
    icon: Volume2,
    title: "A voice when you're needed",
    description:
      "Hear when a session is waiting on you, and get long replies summarised out loud.",
  },
  {
    icon: Network,
    title: "Everything running, live",
    description:
      "Every session and subagent across the team, with branch, task and state.",
  },
  {
    icon: Terminal,
    title: "One-command plugin",
    description:
      "Install the Claude Code plugin in a minute. It works in any editor or terminal.",
  },
] as const;

const DEFAULT_HEADING = "From session history to help in the moment";
const DEFAULT_SUBHEADING =
  "Every Claude Code session your team runs makes the next one easier. DevScope does the remembering.";

/* -------------------------------------------------------------------------- */
/*  Scroll-reveal animation variants                                          */
/* -------------------------------------------------------------------------- */

const cardInitial = { opacity: 0, y: 20 } as const;
const cardVisible = { opacity: 1, y: 0 } as const;
const cardViewport = { once: true, amount: 0.2 } as const;

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function FeaturesSection() {
  const { persona } = usePersona();
  const content = persona ? getFeaturesContent(persona) : null;
  const heading = content?.heading ?? DEFAULT_HEADING;
  const subheading = content?.subheading ?? DEFAULT_SUBHEADING;
  const features = content?.items ?? DEFAULT_FEATURES;

  return (
    <section id="features" className="relative isolate py-24 px-4">
      <Backdrop pattern="dots" fadeFrom="top" glows={[{ color: "violet", at: "85% 10%", size: "35% 30%", opacity: 0.08 }]} />
      <div className="max-w-6xl mx-auto">
        {/* ---- Section heading ---- */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-balance text-foreground">
            {heading}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            {subheading}
          </p>
        </div>

        {/* ---- Feature card grid ---- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <FeatureCard key={feature.title} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Individual feature card                                                   */
/* -------------------------------------------------------------------------- */

function FeatureCard({ feature, index }: { feature: Feature | FeatureItem; index: number }) {
  const Icon = feature.icon;

  return (
    <motion.div
      initial={cardInitial}
      whileInView={cardVisible}
      viewport={cardViewport}
      transition={{ delay: index * 0.1, duration: 0.4, ease: "easeOut" }}
    >
      <Card
        className={cn(
          "h-full hover:border-foreground/20 transition-colors"
        )}
      >
        <CardHeader>
          <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center mb-4">
            <Icon className="h-5 w-5 text-foreground" />
          </div>
          <CardTitle>{feature.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription>{brandify(feature.description)}</CardDescription>
        </CardContent>
      </Card>
    </motion.div>
  );
}
