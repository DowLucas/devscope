import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  GitBranch,
  Sparkles,
  Terminal,
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
    icon: Activity,
    title: "Pattern Discovery",
    description:
      "Surface effective workflows from real session data. See which tool sequences and prompting styles lead to the best outcomes.",
  },
  {
    icon: GitBranch,
    title: "Anti-Pattern Detection",
    description:
      "Automatically flag common pitfalls — retry loops, high failure-rate tools, and inefficient workflows — so your team can learn from them.",
  },
  {
    icon: BarChart3,
    title: "Team Skill Mapping",
    description:
      "Understand how your team adopts AI tools over time. Track which skills are developing and where coaching can help most.",
  },
  {
    icon: AlertTriangle,
    title: "Suggested Improvements",
    description:
      "AI-generated recommendations based on session patterns — concrete tips to help developers get more from every Claude Code session.",
  },
  {
    icon: Sparkles,
    title: "Shareable Learnings",
    description:
      "AI-generated reports that highlight what's working, what isn't, and which patterns to adopt or avoid.",
  },
  {
    icon: Terminal,
    title: "Zero-Friction Plugin",
    description:
      "Install the Claude Code plugin with a single command. Non-blocking hooks mean zero impact on developer workflow.",
  },
] as const;

const DEFAULT_HEADING = "Turn AI usage data into\u00a0team\u00a0skills";
const DEFAULT_SUBHEADING =
  "DevScope finds patterns in how your team uses AI — surfacing effective workflows, catching anti-patterns, and helping everyone level up.";

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
    <section id="features" className="py-24 px-4">
      <div className="max-w-6xl mx-auto">
        {/* ---- Section heading ---- */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
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
