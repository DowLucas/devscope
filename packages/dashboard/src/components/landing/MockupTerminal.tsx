import { useEffect, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Users, Volume2 } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  A Claude Code session with DevScope, played line by line.          */
/*  The DevScope lines use the plugin's real wording                   */
/*  (scripts/error-recall.sh, the devscope-live mod).                  */
/* ------------------------------------------------------------------ */

interface Line {
  key: string;
  /** Pause before this line appears, in ms. */
  delay: number;
  node: ReactNode;
}

const dim = "text-gray-500";

const LINES: Line[] = [
  {
    key: "prompt",
    delay: 400,
    node: (
      <div className="text-gray-100">
        <span className={dim}>&gt; </span>fix the failing auth test
      </div>
    ),
  },
  {
    key: "bash1",
    delay: 900,
    node: (
      <div>
        <span className="text-emerald-400">●</span> <span className="text-gray-100">Bash</span>
        <span className={dim}>(bun test src/auth)</span>
      </div>
    ),
  },
  {
    key: "fail",
    delay: 900,
    node: (
      <div className="pl-4 text-red-400">
        <span className={dim}>⎿ </span>TypeError: Cannot read properties of undefined (reading 'token')
      </div>
    ),
  },
  {
    key: "recall",
    delay: 700,
    node: (
      <div className="my-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-blue-300">
        DevScope: you've hit this error before (3x, 2 resolved). Claude has the notes.
      </div>
    ),
  },
  {
    key: "claude",
    delay: 1100,
    node: (
      <div className="text-gray-200">
        <span className="text-gray-100">●</span> Last time this was fixed by awaiting{" "}
        <span className="text-violet-300">refreshToken()</span> before reading the token. Applying that.
      </div>
    ),
  },
  {
    key: "edit",
    delay: 1000,
    node: (
      <div>
        <span className="text-emerald-400">●</span> <span className="text-gray-100">Edit</span>
        <span className={dim}>(src/auth/session.ts)</span>
        <span className="ml-2 text-emerald-400">+1</span> <span className="text-red-400">−1</span>
      </div>
    ),
  },
  {
    key: "bash2",
    delay: 900,
    node: (
      <div>
        <span className="text-emerald-400">●</span> <span className="text-gray-100">Bash</span>
        <span className={dim}>(bun test src/auth)</span>
        <div className="pl-4 text-emerald-400">
          <span className={dim}>⎿ </span>14 passed
        </div>
      </div>
    ),
  },
  {
    key: "voice",
    delay: 1000,
    node: (
      <div className="mt-1 flex items-center gap-2 text-amber-300">
        <Volume2 className="size-3.5 shrink-0" />
        <VoiceBars />
        <span className="italic">"Auth tests pass. The session now waits for the token refresh."</span>
      </div>
    ),
  },
  {
    key: "next",
    delay: 1400,
    node: (
      <div className="mt-2 flex items-center gap-2 border-t border-gray-800 pt-2">
        <span className={dim}>&gt;</span>
        <span className="text-gray-600">open a PR</span>
        <span className="ml-auto flex items-center gap-1 rounded-full border border-gray-700 px-2 py-0.5 text-[10px] text-gray-400">
          <Users className="size-3" /> worked for your team
        </span>
      </div>
    ),
  },
];

/** How long the finished session stays on screen before it plays again. */
const HOLD_MS = 5000;

function VoiceBars() {
  return (
    <span className="flex h-3 items-end gap-0.5" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="w-0.5 rounded-full bg-amber-300"
          animate={{ height: ["30%", "100%", "50%", "80%", "30%"] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

export function MockupTerminal() {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(reduceMotion ? LINES.length : 0);

  useEffect(() => {
    if (reduceMotion) return;
    const delay = shown < LINES.length ? LINES[shown].delay : HOLD_MS;
    const timer = setTimeout(() => setShown((n) => (n < LINES.length ? n + 1 : 0)), delay);
    return () => clearTimeout(timer);
  }, [shown, reduceMotion]);

  return (
    <div
      className="h-[420px] sm:h-[340px] overflow-hidden bg-gray-950 px-5 py-4 text-left font-mono text-xs leading-relaxed sm:text-[13px]"
      role="img"
      aria-label="A Claude Code session where DevScope recalls an earlier fix for a failing test, then speaks a summary and suggests the next prompt."
    >
      {LINES.slice(0, shown).map((line) => (
        <motion.div
          key={line.key}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="mb-1"
        >
          {line.node}
        </motion.div>
      ))}
      {shown < LINES.length ? (
        <motion.span
          className="inline-block h-3.5 w-2 bg-gray-500 align-middle"
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
        />
      ) : null}
    </div>
  );
}
