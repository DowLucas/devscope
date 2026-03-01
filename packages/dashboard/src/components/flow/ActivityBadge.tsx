import { motion, AnimatePresence } from "motion/react";
import type { DevscopeEvent, ToolEventPayload } from "@devscope/shared";

interface ActivityBadgeProps {
  isToolRunning: boolean;
  activityLabel: string;
  activityColor: string;
  displayEvent: DevscopeEvent | null;
}

function AnimatedCheck() {
  return (
    <motion.svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 shrink-0 text-emerald-400"
      initial={{ scale: 0, rotate: -45 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 10 }}
    >
      <motion.path
        d="M20 6L9 17l-5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.3, delay: 0.12, ease: [0.65, 0, 0.35, 1] }}
      />
    </motion.svg>
  );
}

export function ActivityBadge({
  isToolRunning,
  activityLabel,
  activityColor,
  displayEvent,
}: ActivityBadgeProps) {
  if (!displayEvent) return null;

  const isToolComplete = displayEvent.eventType === "tool.complete";
  const completedToolName = isToolComplete
    ? (displayEvent.payload as ToolEventPayload).toolName
    : null;

  // Stable key during tool running → complete so the chip morphs in place
  const isToolPhase = isToolRunning || isToolComplete;
  const animKey = isToolPhase ? "tool-phase" : `${displayEvent.id}-${activityLabel}`;

  return (
    <div className="mt-2 border-t border-gray-800 pt-2" style={{ minHeight: 28 }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={animKey}
          className="flex items-center gap-2"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
        >
          {/* Icon: pulsing dot bursts outward on exit, check bounces in */}
          <AnimatePresence mode="wait">
            {isToolRunning ? (
              <motion.span
                key="pulse"
                className="h-2 w-2 shrink-0 rounded-full bg-amber-400"
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                exit={{ scale: 2, opacity: 0, transition: { duration: 0.15 } }}
              />
            ) : isToolComplete ? (
              <AnimatedCheck key="check" />
            ) : null}
          </AnimatePresence>

          {/* Label: color transitions smoothly via CSS */}
          <span
            className={`inline-block truncate rounded px-1.5 py-0.5 text-xs transition-colors duration-300 ${
              isToolComplete
                ? "text-emerald-400 bg-emerald-500/15"
                : activityColor
            }`}
          >
            {isToolRunning ? "Running: " : ""}
            {isToolComplete ? completedToolName : activityLabel}
          </span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
