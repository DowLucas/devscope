import { motion } from "motion/react";
import type { DevscopeEvent } from "@devscope/shared";
import { timeAgo } from "@/lib/utils";
import { EVENT_COLORS, EVENT_LABELS, getEventSummary } from "@/lib/eventDisplay";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function EventCard({ event }: { event: DevscopeEvent }) {
  const p = event.payload as unknown as Record<string, unknown>;
  const isInterrupt = event.eventType === "tool.fail" && p.isInterrupt === true;
  const colorClass = isInterrupt
    ? "border-amber-500/50 bg-amber-500/5"
    : (EVENT_COLORS[event.eventType] ?? "border-gray-500/50 bg-gray-500/5");
  const label = isInterrupt
    ? "Tool Interrupted"
    : (EVENT_LABELS[event.eventType] ?? event.eventType);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={"border rounded-lg p-3 " + colorClass}
    >
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold shrink-0">
          {getInitials(event.developerName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{event.developerName}</span>
            <span className="text-gray-500">in</span>
            <span className="text-gray-300 font-mono text-xs">{event.projectName}</span>
          </div>
          <div className="text-sm text-gray-400 truncate">
            <span className="text-gray-500">{label}:</span>{" "}
            {getEventSummary(event)}
          </div>
        </div>
        <span className="text-xs text-gray-600 shrink-0">{timeAgo(event.timestamp)}</span>
      </div>
    </motion.div>
  );
}
