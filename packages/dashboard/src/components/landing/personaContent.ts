import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  Briefcase,
  GitBranch,
  Lightbulb,
  LineChart,
  Sparkles,
  Target,
  Terminal,
  TrendingUp,
  Workflow,
  Zap,
} from "lucide-react";
import type { Persona } from "./PersonaContext";

/* ------------------------------------------------------------------ */
/*  Persona-aware content for all landing page sections                 */
/* ------------------------------------------------------------------ */

/* ---- Hero -------------------------------------------------------- */

interface HeroContent {
  badge: string;
  headline: string;
  headlineAccent: string;
  subtext: string;
}

const HERO: Record<Persona, HeroContent> = {
  technical: {
    badge: "Open Source Developer Insights",
    headline: "Understand how you use Claude Code.",
    headlineAccent: "Ship smarter.",
    subtext:
      "DevScope gives you deep insight into your Claude Code sessions — see which tools you lean on, where you get stuck, and how to get more from every prompt.",
  },
  "non-technical": {
    badge: "Agentic Engineering Intelligence",
    headline: "Measure the impact of agentic engineering.",
    headlineAccent: "Quantify ROI.",
    subtext:
      "As engineering shifts to agent-orchestrated workflows, leaders need new metrics. DevScope delivers team velocity, adoption analytics, cost-per-session data, and executive-ready briefings.",
  },
};

export function getHeroContent(p: Persona): HeroContent {
  return HERO[p];
}

/* ---- Features ---------------------------------------------------- */

export interface FeatureItem {
  icon: LucideIcon;
  title: string;
  description: string;
}

interface FeaturesContent {
  heading: string;
  subheading: string;
  items: readonly FeatureItem[];
}

const FEATURES: Record<Persona, FeaturesContent> = {
  technical: {
    heading: "Insights that sharpen your workflow",
    subheading:
      "From session replays to tool-usage breakdowns, DevScope helps you understand and improve how you code with AI.",
    items: [
      {
        icon: Activity,
        title: "Session Replay & Timeline",
        description:
          "Review every prompt and tool call in chronological order. Spot patterns and understand the flow of your work.",
      },
      {
        icon: GitBranch,
        title: "Project-Level Breakdown",
        description:
          "See how your sessions map to repositories. Understand which projects get the most agentic engineering activity.",
      },
      {
        icon: BrainCircuit,
        title: "Tool Usage Heatmaps",
        description:
          "Discover which tools you use most, which ones fail, and where you spend the most time waiting.",
      },
      {
        icon: Lightbulb,
        title: "Workflow Suggestions",
        description:
          "AI-generated tips based on your session patterns — learn techniques that other productive developers use.",
      },
      {
        icon: Zap,
        title: "Stuck-Session Alerts",
        description:
          "Get notified when a session spins without progress so you can break out of loops faster.",
      },
      {
        icon: Terminal,
        title: "Zero-Friction Plugin",
        description:
          "Install with a single command. Non-blocking hooks mean zero overhead — your workflow stays untouched.",
      },
    ],
  },
  "non-technical": {
    heading: "Business intelligence for agentic engineering",
    subheading:
      "From adoption metrics to executive briefings, DevScope turns agentic engineering activity into actionable insights.",
    items: [
      {
        icon: TrendingUp,
        title: "Team Velocity Analytics",
        description:
          "Track sessions per developer, compare sprint-over-sprint productivity, and identify capacity trends across your team.",
      },
      {
        icon: LineChart,
        title: "Adoption & ROI Metrics",
        description:
          "Measure agentic engineering adoption rates, session frequency, and correlate agent usage with engineering output.",
      },
      {
        icon: Briefcase,
        title: "Executive Briefings",
        description:
          "AI-generated summaries delivered on your schedule — understand team activity without reading every data point.",
      },
      {
        icon: Target,
        title: "Resource Allocation Insights",
        description:
          "See which projects consume the most agentic engineering time and align investment with priorities.",
      },
      {
        icon: AlertTriangle,
        title: "Risk & Anomaly Detection",
        description:
          "Automatically flag stalled sessions, unusual usage spikes, and potential blockers before they impact delivery.",
      },
      {
        icon: Workflow,
        title: "Team Comparison Dashboards",
        description:
          "Benchmark teams and individuals. Identify best practices from top performers and scale them across the org.",
      },
    ],
  },
};

export function getFeaturesContent(p: Persona): FeaturesContent {
  return FEATURES[p];
}

/* ---- How It Works ------------------------------------------------ */

export interface StepItem {
  number: number;
  icon: LucideIcon;
  title: string;
  description: string;
}

const STEPS: Record<Persona, readonly StepItem[]> = {
  technical: [
    {
      number: 1,
      icon: Terminal,
      title: "Install the Plugin",
      description:
        "Run a single setup command. The DevScope plugin hooks into your Claude Code sessions automatically — no config required.",
    },
    {
      number: 2,
      icon: Activity,
      title: "Code as Usual",
      description:
        "Keep working the way you always do. Every session, prompt, and tool call is captured in the background with zero performance impact.",
    },
    {
      number: 3,
      icon: Sparkles,
      title: "Review Your Insights",
      description:
        "Open DevScope to see session timelines, tool usage patterns, and AI-generated suggestions to sharpen your workflow.",
    },
  ],
  "non-technical": [
    {
      number: 1,
      icon: Terminal,
      title: "Roll Out to Your Team",
      description:
        "Developers install the DevScope plugin with one command. It runs silently alongside Claude Code — no behavior change required.",
    },
    {
      number: 2,
      icon: BarChart3,
      title: "Data Flows Automatically",
      description:
        "As your team works, DevScope captures session activity and builds analytics — adoption rates, velocity, and project breakdowns.",
    },
    {
      number: 3,
      icon: Briefcase,
      title: "Get Actionable Intelligence",
      description:
        "Review dashboards, receive executive briefings, and make data-driven decisions about your agentic engineering investment.",
    },
  ],
};

export function getStepsContent(p: Persona): readonly StepItem[] {
  return STEPS[p];
}

/* ---- CTA --------------------------------------------------------- */

interface CtaContent {
  heading: string;
  subtext: string;
  buttonLabel: string;
}

const CTA: Record<Persona, CtaContent> = {
  technical: {
    heading: "Start understanding your Claude Code workflow",
    subtext:
      "Set up DevScope in under 5 minutes. Open source, self-hosted, zero overhead on your development flow.",
    buttonLabel: "Get Started Free",
  },
  "non-technical": {
    heading: "Start measuring your team's agentic engineering ROI",
    subtext:
      "Deploy DevScope in minutes. Self-hosted, open source, and designed for engineering leaders who need real data.",
    buttonLabel: "Get Started Free",
  },
};

export function getCtaContent(p: Persona): CtaContent {
  return CTA[p];
}

/* ---- FAQ --------------------------------------------------------- */

interface FaqItem {
  question: string;
  answer: string;
}

const FAQ: Record<Persona, readonly FaqItem[]> = {
  technical: [
    {
      question: "Will DevScope slow down my Claude Code sessions?",
      answer:
        "No. The plugin uses async, non-blocking bash hooks with zero milliseconds of overhead. Your sessions run exactly as fast as before.",
    },
    {
      question: "What data does DevScope collect?",
      answer:
        "DevScope captures session lifecycle events, tool usage patterns, and prompt metadata. It does not collect prompt content or your code — only structural information about how sessions progress.",
    },
    {
      question: "Can I self-host DevScope?",
      answer:
        "Yes! DevScope is fully open source and designed for self-hosting. Deploy with Docker Compose in minutes. Your data stays on your infrastructure.",
    },
    {
      question: "How do I see my personal insights?",
      answer:
        "After installing the plugin, open the DevScope dashboard. Your sessions appear in real time with timelines, tool-usage breakdowns, and AI-generated workflow suggestions.",
    },
    {
      question: "Does it work with any IDE?",
      answer:
        "DevScope works with Claude Code CLI regardless of which editor or IDE you use. If Claude Code runs, DevScope captures insights from it.",
    },
  ],
  "non-technical": [
    {
      question: "What is DevScope?",
      answer:
        "DevScope is an open-source analytics platform that gives engineering leaders visibility into agentic engineering workflows. It captures team-wide session activity and turns it into actionable business intelligence — adoption metrics, velocity trends, and executive briefings.",
    },
    {
      question: "How does rollout work for my team?",
      answer:
        "Developers install a lightweight plugin with a single command. It runs silently alongside Claude Code with zero impact on their workflow. No behavior change or training required.",
    },
    {
      question: "What kind of metrics can I track?",
      answer:
        "Team velocity, adoption rates, sessions per developer, project-level breakdowns, failure patterns, and cost correlations. DevScope also generates AI-powered executive briefings on demand.",
    },
    {
      question: "Is the data secure?",
      answer:
        "DevScope is fully self-hosted — your data never leaves your infrastructure. It captures session metadata only, not source code or prompt content.",
    },
    {
      question: "Can I compare team performance?",
      answer:
        "Yes. DevScope includes developer comparison dashboards, period-over-period analytics, and team benchmarks so you can identify best practices and scale them.",
    },
  ],
};

export function getFaqContent(p: Persona): readonly FaqItem[] {
  return FAQ[p];
}
