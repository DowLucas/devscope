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
      "DevScope is an open-source observability platform for agentic engineering workflows. It gives teams and leaders visibility into Claude Code sessions — every prompt, tool call, and agent spawn — as engineering shifts from writing code to orchestrating AI agents.",
  },
  {
    question: "How does the plugin work?",
    answer:
      "The DevScope plugin installs as Claude Code hooks — lightweight bash scripts that fire on session events like prompts, tool calls, and session lifecycle changes. All hooks are async and non-blocking, so there's zero impact on developer workflow.",
  },
  {
    question: "What data does DevScope collect?",
    answer:
      "DevScope captures session lifecycle events, tool usage patterns, and prompt metadata. It does not collect prompt content or code — only structural information about how sessions progress.",
  },
  {
    question: "Can I self-host DevScope?",
    answer:
      "Yes! DevScope is fully open source and designed for self-hosting. Deploy with Docker Compose in minutes. Your data stays on your infrastructure.",
  },
  {
    question: "Does it work with any IDE?",
    answer:
      "DevScope works with Claude Code CLI regardless of which editor or IDE you use. If Claude Code runs, DevScope monitors it.",
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
