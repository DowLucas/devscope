import { motion, AnimatePresence } from "motion/react";
import { Code2, Briefcase } from "lucide-react";
import { usePersona, type Persona } from "./PersonaContext";

/* ------------------------------------------------------------------ */
/*  PersonaOverlay — Full-screen modal asking technical vs non-tech    */
/*  Shown once, persisted to localStorage via PersonaContext           */
/* ------------------------------------------------------------------ */

const OPTIONS: { id: Persona; icon: typeof Code2; label: string; desc: string }[] = [
  {
    id: "technical",
    icon: Code2,
    label: "I am technical",
    desc: "I live in the terminal and mass-accept tool calls",
  },
  {
    id: "non-technical",
    icon: Briefcase,
    label: "I am non-technical",
    desc: "I need graphs for my graphs",
  },
];

export function PersonaOverlay() {
  const { persona, setPersona } = usePersona();

  return (
    <AnimatePresence>
      {persona === null && (
        <motion.div
          key="persona-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        >
          {/* Backdrop — dark gradient + blur */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/70 to-black/80 backdrop-blur-md"
          />

          {/* Card */}
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
            className="relative w-full max-w-md rounded-2xl border border-white/[0.08] bg-zinc-950/90 p-8 shadow-2xl"
          >
            {/* Heading */}
            <h2 className="text-center text-xl font-semibold tracking-tight text-white">
              How do you plan to use DevScope?
            </h2>
            <p className="mt-2 text-center text-sm text-white/50">
              We'll tailor the experience for you.
            </p>

            {/* Options */}
            <div className="mt-8 flex flex-col gap-3">
              {OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setPersona(opt.id)}
                  className="group flex items-center gap-4 rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-left transition-all hover:border-blue-500/40 hover:bg-blue-500/[0.06] cursor-pointer"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] ring-1 ring-white/[0.08] transition-colors group-hover:bg-blue-500/10 group-hover:ring-blue-500/30">
                    <opt.icon className="size-5 text-white/70 transition-colors group-hover:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white/90">{opt.label}</p>
                    <p className="text-xs text-white/40">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
