import { motion } from "motion/react";
import type { GroundcontrolEvent } from "@groundcontrol/shared";

const EVENT_COLORS: Record<string, string> = {
  "session.start": "border-emerald-500/50 bg-emerald-500/5",
  "session.end": "border-gray-500/50 bg-gray-500/5",
  "prompt.submit": "border-blue-500/50 bg-blue-500/5",
  "tool.start": "border-amber-500/50 bg-amber-500/5",
  "tool.complete": "border-green-500/50 bg-green-500/5",
  "tool.fail": "border-red-500/50 bg-red-500/5",
  "agent.start": "border-purple-500/50 bg-purple-500/5",
  "agent.stop": "border-purple-500/30 bg-purple-500/5",
  "response.complete": "border-cyan-500/50 bg-cyan-500/5",
};

const EVENT_LABELS: Record<string, string> = {
  "session.start": "Session Started",
  "session.end": "Session Ended",
  "prompt.submit": "Prompt",
  "tool.start": "Tool Started",
  "tool.complete": "Tool Completed",
  "tool.fail": "Tool Failed",
  "agent.start": "Agent Spawned",
  "agent.stop": "Agent Finished",
  "response.complete": "Response Complete",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getEventSummary(event: GroundcontrolEvent): string {
  const p = event.payload as unknown as Record<string, unknown>;
  switch (event.eventType) {
    case "tool.start":
    case "tool.complete":
    case "tool.fail":
      return String(p.toolName ?? "Unknown tool");
    case "prompt.submit": {
      const content = String(p.promptContent ?? "");
      return content.slice(0, 80) + (content.length > 80 ? "..." : "");
    }
    case "session.start":
      return "Started (" + (p.startType ?? "startup") + ")";
    case "session.end":
      return "Ended (" + (p.endReason ?? "unknown") + ")";
    case "agent.start":
    case "agent.stop":
      return String(p.agentType ?? "Agent");
    default:
      return event.eventType;
  }
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return seconds + "s ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  return hours + "h ago";
}

export function EventCard({ event }: { event: GroundcontrolEvent }) {
  const colorClass = EVENT_COLORS[event.eventType] ?? "border-gray-500/50 bg-gray-500/5";

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
            <span className="text-gray-500">{EVENT_LABELS[event.eventType] ?? event.eventType}:</span>{" "}
            {getEventSummary(event)}
          </div>
        </div>
        <span className="text-xs text-gray-600 shrink-0">{timeAgo(event.timestamp)}</span>
      </div>
    </motion.div>
  );
}
