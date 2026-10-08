import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Briefcase,
  History,
  MessageSquareText,
  Network,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users,
  Volume2,
  Wrench,
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
    badge: "Open source toolkit for Claude Code",
    headline: "Get more out of Claude Code.",
    headlineAccent: "Spend less time babysitting it.",
    subtext:
      "DevScope adds the tools Claude Code is missing: a voice that tells you when a session needs you, a live view of every session and subagent, fixes recalled from errors you've hit before, and search across everything you've done.",
  },
  "non-technical": {
    badge: "For teams adopting Claude Code",
    headline: "What one developer figures out,",
    headlineAccent: "the whole team gets.",
    subtext:
      "DevScope puts your team's proven prompts, skills and fixes in front of every developer while they work, and shows you where tools and workflows slow the team down. No rankings, no surveillance.",
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
    heading: "The tools around Claude Code",
    subheading:
      "Small, focused helpers that run inside Claude Code and fail open. Turn on what you want, switch off what you don't.",
    items: [
      {
        icon: Volume2,
        title: "Know when a session needs you",
        description:
          "A voice tells you when Claude is waiting on a permission prompt or a question, so you can work elsewhere and stop checking tabs.",
      },
      {
        icon: Network,
        title: "Every session at a glance",
        description:
          "All your sessions and subagents live, with branch, task, state, tool failures, tokens and cost.",
      },
      {
        icon: History,
        title: "Fixes you've already found",
        description:
          "When a tool call fails with an error you've hit before, Claude gets the call that fixed it last time.",
      },
      {
        icon: Search,
        title: "Search everything you've done",
        description:
          "Find any past prompt or reply by meaning, not just keywords, from the dashboard or /devscope:search.",
      },
      {
        icon: Terminal,
        title: "Slash commands",
        description:
          "/devscope:review critiques the current session, /devscope:upskill proposes CLAUDE.md fixes, /devscope:ask answers questions about your history.",
      },
      {
        icon: MessageSquareText,
        title: "Next steps that worked before",
        description:
          "After a PR or a skill, get the step you usually take next, and prompts that worked for your team as you type.",
      },
    ],
  },
  "non-technical": {
    heading: "Your team's best sessions, shared",
    subheading:
      "DevScope turns what works in one developer's sessions into help for everyone, and shows you where the team gets stuck.",
    items: [
      {
        icon: Users,
        title: "Shared know-how",
        description:
          "A prompt, skill or fix that worked for one developer is offered to the next one when they need it.",
      },
      {
        icon: Network,
        title: "Live team view",
        description:
          "See what's running across the team and which sessions are waiting on someone.",
      },
      {
        icon: Wrench,
        title: "Tooling friction",
        description:
          "Find the tools and projects where sessions keep failing. Problems are tied to tools, never to people.",
      },
      {
        icon: BookOpen,
        title: "Team skills and playbooks",
        description:
          "Turn effective patterns into skills Claude Code can follow, shared across your organisation.",
      },
      {
        icon: Sparkles,
        title: "AI team reports",
        description:
          "Summaries of what's working, what isn't, and what to try next, across the whole team.",
      },
      {
        icon: ShieldCheck,
        title: "Trust built in",
        description:
          "Developers choose what they share. Team views are aggregate, with no rankings or productivity scores.",
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
    heading: "Get more out of Claude Code",
    subtext:
      "Install the plugin in under 5 minutes. Open source, self-hostable, and you choose what's shared.",
    buttonLabel: "Get Started Free",
  },
  "non-technical": {
    heading: "Make every session count for the whole team",
    subtext:
      "Roll DevScope out in minutes. Open source, self-hostable, and every developer controls what they share.",
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
        "No. Event capture runs in the background and never waits on the network. The only hooks that run inline are prompt recall, error recall and next-step hints, each capped at 5 seconds and skipped on any error, and each can be turned off.",
    },
    {
      question: "What data does DevScope collect?",
      answer:
        "That's your choice. In the default standard mode the plugin sends session events, tool calls with their inputs, and your prompt text. Set DEVSCOPE_PRIVACY=private to send only tool names, file paths and durations, or open to add Claude's responses for full replay. Your teammates see none of your content unless you turn on team sharing.",
    },
    {
      question: "How do I opt out?",
      answer:
        "Use private mode to keep prompts and responses on your machine. Leave team sharing off (the default) so teammates only see that you're active. Turn off recall or hints individually with DEVSCOPE_PREFLIGHT, DEVSCOPE_ERROR_RECALL or DEVSCOPE_HINTS set to off. You can request an export or deletion of your data from the dashboard at any time.",
    },
    {
      question: "Can I self-host DevScope?",
      answer:
        "Yes! DevScope is fully open source and designed for self-hosting. Deploy with Docker Compose in minutes. Your data stays on your infrastructure.",
    },
    {
      question: "How does it help me improve?",
      answer:
        "Mostly in the moment: it recalls fixes and earlier answers as you work, and suggests next steps that worked before. Looking back, /devscope:upskill reads where your sessions got stuck and proposes changes to your CLAUDE.md and memory.",
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
        "DevScope is an open-source companion for Claude Code. It remembers your team's sessions and brings what worked back to each developer while they work, and gives you a live, aggregate view of how the team uses Claude Code.",
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
        "Developers control what is sent. By default the plugin sends prompt text and tool activity; private mode sends metadata only. Each developer decides whether teammates can see their sessions, and it is off by default. Self-host DevScope to keep the data on your infrastructure. AI-generated summaries use an external model provider and only see what each developer's privacy mode allows.",
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
