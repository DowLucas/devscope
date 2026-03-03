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
    badge: "Open Source AI Upskilling",
    headline: "Level up how you use Claude Code.",
    headlineAccent: "Ship smarter.",
    subtext:
      "DevScope analyzes your Claude Code sessions to reveal what's working and what isn't — discover effective patterns, break out of anti-patterns, and build better AI workflows over time.",
  },
  "non-technical": {
    badge: "AI Development Upskilling Platform",
    headline: "Help your team master AI-assisted development.",
    headlineAccent: "Faster.",
    subtext:
      "DevScope turns AI usage data into actionable team skills — surface effective patterns, identify anti-patterns to avoid, and accelerate adoption with data-driven coaching.",
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
    heading: "Build better AI skills, session by session",
    subheading:
      "DevScope turns your Claude Code usage into a personal learning tool — revealing patterns, flagging anti-patterns, and suggesting better workflows.",
    items: [
      {
        icon: Activity,
        title: "Session Replay & Timeline",
        description:
          "Review every prompt and tool call in chronological order. Spot what works, learn from what doesn't, and refine your approach.",
      },
      {
        icon: GitBranch,
        title: "Pattern Library",
        description:
          "See which tool sequences and prompting styles lead to success. Build a personal playbook of effective AI workflows.",
      },
      {
        icon: BrainCircuit,
        title: "Anti-Pattern Alerts",
        description:
          "Get flagged when you hit common pitfalls — retry loops, high-failure tools, or inefficient sequences — with suggestions to break out.",
      },
      {
        icon: Lightbulb,
        title: "AI-Powered Suggestions",
        description:
          "Receive personalized tips based on your session patterns — concrete techniques to improve how you work with Claude Code.",
      },
      {
        icon: Zap,
        title: "Skill Progress",
        description:
          "See how your AI workflows improve over time. Track which tools you've mastered and where you're still learning.",
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
    heading: "Upskill your team's AI development",
    subheading:
      "DevScope helps teams learn from their AI usage — surfacing effective patterns, catching anti-patterns, and accelerating skill development.",
    items: [
      {
        icon: TrendingUp,
        title: "Adoption & Skill Trends",
        description:
          "Understand how your team's AI skills are developing over time. See adoption curves, tool mastery, and areas where coaching can help.",
      },
      {
        icon: LineChart,
        title: "Pattern & Anti-Pattern Reports",
        description:
          "Identify which AI workflows succeed across your team and which common anti-patterns are costing time.",
      },
      {
        icon: Briefcase,
        title: "Team Learning Reports",
        description:
          "AI-generated summaries highlighting team patterns to adopt, anti-patterns to avoid, and skills to develop next.",
      },
      {
        icon: Target,
        title: "Project-Level Insights",
        description:
          "See which projects benefit most from AI-assisted development and where teams can improve their approach.",
      },
      {
        icon: AlertTriangle,
        title: "Blocker Detection",
        description:
          "Automatically surface sessions with high failure rates — identify tooling issues and workflow blockers early.",
      },
      {
        icon: Workflow,
        title: "Shareable Playbooks",
        description:
          "Turn successful patterns into team knowledge. Share what works so everyone can level up together.",
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
      title: "Learn & Improve",
      description:
        "Open DevScope to review your sessions, discover effective patterns, catch anti-patterns, and get AI-generated suggestions to level up.",
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
      title: "Coach & Upskill",
      description:
        "Review team patterns, share effective workflows, and use AI-generated learning briefs to help your team build better AI skills.",
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
    heading: "Start leveling up your AI workflow today",
    subtext:
      "Set up DevScope in under 5 minutes. Open source, self-hosted, zero overhead on your development flow.",
    buttonLabel: "Get Started Free",
  },
  "non-technical": {
    heading: "Start upskilling your team's AI development",
    subtext:
      "Deploy DevScope in minutes. Self-hosted, open source, and designed for teams that want to get better at AI-assisted development.",
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
      question: "How does it help me improve?",
      answer:
        "DevScope analyzes your session patterns and highlights effective workflows, flags anti-patterns like retry loops, and generates AI-powered suggestions to help you build better AI development skills over time.",
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
        "DevScope is an open-source upskilling platform for AI-assisted development. It analyzes team-wide Claude Code sessions to surface effective patterns, flag anti-patterns, and help your team build better AI workflows over time.",
    },
    {
      question: "How does rollout work for my team?",
      answer:
        "Developers install a lightweight plugin with a single command. It runs silently alongside Claude Code with zero impact on their workflow. No behavior change or training required.",
    },
    {
      question: "What kind of insights does it provide?",
      answer:
        "Pattern and anti-pattern reports, adoption trends, skill development curves, tool mastery breakdowns, and project-level insights. DevScope also generates AI-powered team learning briefs on demand.",
    },
    {
      question: "Is the data secure?",
      answer:
        "DevScope is fully self-hosted — your data never leaves your infrastructure. It captures session metadata only, not source code or prompt content.",
    },
    {
      question: "How does it help upskill my team?",
      answer:
        "DevScope identifies which AI workflows succeed and which don't, then generates shareable learning briefs. Teams can see which patterns to adopt, which anti-patterns to avoid, and track skill development over time.",
    },
  ],
};

export function getFaqContent(p: Persona): readonly FaqItem[] {
  return FAQ[p];
}
