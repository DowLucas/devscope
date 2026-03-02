import { motion } from "motion/react";
import { usePersona } from "./PersonaContext";
import { getCtaContent } from "./personaContent";
import { brandify } from "./ClaudeBrand";

/* ------------------------------------------------------------------ */
/*  CtaSection — Final call-to-action with radial gradient backdrop    */
/*  Content adapts based on selected persona                           */
/* ------------------------------------------------------------------ */

const revealInitial = { opacity: 0, y: 20 } as const;
const revealVisible = { opacity: 1, y: 0 } as const;
const revealViewport = { once: true, amount: 0.3 } as const;

const DEFAULT = {
  heading: "Start monitoring your AI development today",
  subtext:
    "Set up DevScope in under 5 minutes. Open source, self-hosted, zero developer friction.",
  buttonLabel: "Get Started Free",
};

export function CtaSection() {
  const { persona } = usePersona();
  const c = persona ? getCtaContent(persona) : DEFAULT;

  return (
    <section id="cta" className="relative overflow-hidden py-24 px-4">
      {/* ---- Background radial glow ---- */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,oklch(0.488_0.243_264.376/0.1),transparent_70%)]"
      />

      <div className="relative max-w-3xl mx-auto text-center">
        <motion.h2
          initial={revealInitial}
          whileInView={revealVisible}
          viewport={revealViewport}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground"
        >
          {brandify(c.heading)}
        </motion.h2>

        <motion.p
          initial={revealInitial}
          whileInView={revealVisible}
          viewport={revealViewport}
          transition={{ delay: 0.1, duration: 0.5, ease: "easeOut" }}
          className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto"
        >
          {brandify(c.subtext)}
        </motion.p>

        <motion.div
          initial={revealInitial}
          whileInView={revealVisible}
          viewport={revealViewport}
          transition={{ delay: 0.2, duration: 0.5, ease: "easeOut" }}
          className="mt-8"
        >
          <a
            href="/auth/sign-up"
            className="inline-block rounded-lg bg-primary px-8 py-3 text-base font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {c.buttonLabel}
          </a>
        </motion.div>
      </div>
    </section>
  );
}
