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
    title: "Real-Time Activity Feed",
    description:
      "Watch developer prompts, tool calls, and session events stream in live via WebSocket.",
  },
  {
    icon: GitBranch,
    title: "Session Topology",
    description:
      "Visualize the relationship between developers, sessions, and agents in an interactive flow diagram.",
  },
  {
    icon: BarChart3,
    title: "Team Metrics & Insights",
    description:
      "Track session duration, tool usage, and developer productivity trends over time.",
  },
  {
    icon: AlertTriangle,
    title: "Incident Detection",
    description:
      "Automatically detect stuck sessions, tool failures, and unusual patterns across your team.",
  },
  {
    icon: Sparkles,
    title: "AI Briefings",
    description:
      "Ask natural-language questions about your team's activity and get AI-generated executive briefings.",
  },
  {
    icon: Terminal,
    title: "Zero-Friction Plugin",
    description:
      "Install the Claude Code plugin with a single command. Non-blocking hooks mean zero impact on developer workflow.",
  },
] as const;

const DEFAULT_HEADING = "Everything you need to monitor AI\u00a0development";
const DEFAULT_SUBHEADING =
  "From real-time feeds to AI-generated briefings, DevScope gives you complete visibility.";

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
