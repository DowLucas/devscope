import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { usePersona } from "./PersonaContext";
import { getFaqContent } from "./personaContent";
import { brandify } from "./ClaudeBrand";

/* ------------------------------------------------------------------ */
/*  FaqSection — Expandable FAQ accordion built with motion/react      */
/*  Content adapts based on selected persona                           */
/* ------------------------------------------------------------------ */

interface FaqItem {
  question: string;
  answer: string;
}

const DEFAULT_FAQ: readonly FaqItem[] = [
  {
    question: "What is DevScope?",
    answer:
      "DevScope is an open-source monitoring and upskilling platform for Claude Code developer sessions. It captures session lifecycle events, analyzes AI-assisted workflows, surfaces effective patterns, and helps developers and teams improve their AI engineering skills over time.",
  },
  {
    question: "How does the Claude Code plugin work?",
    answer:
      "The DevScope plugin installs as Claude Code hooks — lightweight async Bash scripts that fire on session events like prompts, tool calls, and session start/end. All hooks run asynchronously and non-blocking, so there is zero impact on your Claude Code workflow. Install with: claude plugin marketplace add DowLucas/devscope-plugin",
  },
  {
    question: "What data does DevScope collect?",
    answer:
      "DevScope offers three privacy modes you control. In 'private' mode it captures only metadata (timestamps, tool names, event counts) with no prompt content. In 'standard' mode (the default) it includes prompt text and session context. In 'open' mode it includes full prompts and responses. You set your privacy level during setup and can change it any time.",
  },
  {
    question: "Can I self-host DevScope?",
    answer:
      "Yes. DevScope is fully open source and built for self-hosting. Deploy the entire stack with Docker Compose in minutes — your session data stays entirely on your infrastructure. A managed cloud version is also available at devscope.sh with no setup required.",
  },
  {
    question: "Does it work with any IDE or editor?",
    answer:
      "DevScope works with the Claude Code CLI regardless of which editor or IDE you use. It hooks into the Claude Code process itself — not your editor — so it captures insights from any environment where Claude Code runs, including VS Code, JetBrains, Neovim, or terminal-only setups.",
  },
  {
    question: "Is DevScope free?",
    answer:
      "Yes. DevScope is free and open source. The plugin is MIT licensed. The cloud version at devscope.sh is free during beta. Self-hosting is always free with no usage limits.",
  },
  {
    question: "How is DevScope different from Claude Code's built-in analytics?",
    answer:
      "Claude Code does not currently provide session-level analytics or team-wide upskilling insights. DevScope fills that gap: it tracks which tools you use, how your sessions are structured, where you get stuck, and what patterns lead to successful outcomes — then surfaces those insights in a dashboard you and your team can act on.",
  },
] as const;

/* ------------------------------------------------------------------ */
/*  Scroll-reveal animation config                                     */
/* ------------------------------------------------------------------ */

const revealInitial = { opacity: 0, y: 20 } as const;
const revealVisible = { opacity: 1, y: 0 } as const;
const revealViewport = { once: true, amount: 0.2 } as const;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function FaqSection() {
  const { persona } = usePersona();
  const faqItems = persona ? getFaqContent(persona) : DEFAULT_FAQ;
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const handleToggle = (index: number) => {
    setOpenIndex((prev) => (prev === index ? null : index));
  };

  return (
    <section id="faq" className="py-24 px-4">
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={revealInitial}
          whileInView={revealVisible}
          viewport={revealViewport}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Frequently asked questions
          </h2>
        </motion.div>

        <div>
          {faqItems.map((item, index) => (
            <FaqAccordionItem
              key={item.question}
              item={item}
              index={index}
              isOpen={openIndex === index}
              onToggle={() => handleToggle(index)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Individual FAQ accordion item                                      */
/* ------------------------------------------------------------------ */

function FaqAccordionItem({
  item,
  index,
  isOpen,
  onToggle,
}: {
  item: FaqItem;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.div
      initial={revealInitial}
      whileInView={revealVisible}
      viewport={revealViewport}
      transition={{ delay: index * 0.08, duration: 0.4, ease: "easeOut" }}
      className="border-b border-border"
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between py-4 text-left text-sm font-medium text-foreground cursor-pointer"
        aria-expanded={isOpen}
      >
        {item.question}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>

      <motion.div
        initial={false}
        animate={{
          height: isOpen ? "auto" : 0,
          opacity: isOpen ? 1 : 0,
        }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        className="overflow-hidden"
      >
        <p className="pb-4 text-sm text-muted-foreground leading-relaxed">
          {brandify(item.answer)}
        </p>
      </motion.div>
    </motion.div>
  );
}
