import { motion } from "motion/react";
import type { DevscopeEvent } from "@devscope/shared";
import { timeAgo } from "@/lib/utils";

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
  "notification": "border-yellow-500/50 bg-yellow-500/5",
  "compact.pending": "border-orange-500/50 bg-orange-500/5",
  "task.completed": "border-teal-500/50 bg-teal-500/5",
  "permission.request": "border-rose-500/50 bg-rose-500/5",
  "worktree.create": "border-indigo-500/50 bg-indigo-500/5",
  "worktree.remove": "border-indigo-500/30 bg-indigo-500/5",
  "config.change": "border-slate-500/50 bg-slate-500/5",
  "compact.complete": "border-orange-500/50 bg-orange-500/5",
  "elicitation.request": "border-violet-500/50 bg-violet-500/5",
  "elicitation.response": "border-violet-500/30 bg-violet-500/5",
  "instructions.loaded": "border-sky-500/50 bg-sky-500/5",
  "teammate.idle": "border-gray-500/30 bg-gray-500/5",
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
  "notification": "Notification",
  "compact.pending": "Compacting Context",
  "task.completed": "Task Completed",
  "permission.request": "Permission Request",
  "worktree.create": "Worktree Created",
  "worktree.remove": "Worktree Removed",
  "config.change": "Config Changed",
  "compact.complete": "Context Compacted",
  "elicitation.request": "MCP Elicitation",
  "elicitation.response": "Elicitation Response",
  "instructions.loaded": "Instructions Loaded",
  "teammate.idle": "Teammate Idle",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getEventSummary(event: DevscopeEvent): string {
  const p = event.payload as unknown as Record<string, unknown>;
  switch (event.eventType) {
    case "tool.start":
    case "tool.complete":
    case "tool.fail":
      return String(p.toolName ?? "Unknown tool");
    case "prompt.submit":
      return (p.promptText as string) || `Prompt (${p.promptLength ?? 0} chars)`;
    case "session.start":
      return "Started (" + (p.startType ?? "startup") + ")";
    case "session.end":
      return "Ended (" + (p.endReason ?? "unknown") + ")";
    case "agent.start":
    case "agent.stop":
      return String(p.agentType ?? "Agent");
    case "notification":
      return String(p.title ?? "Notification");
    case "compact.pending":
      return "Trigger: " + String(p.trigger ?? "auto");
    case "task.completed":
      return String(p.taskSubject ?? "Task");
    case "permission.request":
      return String(p.toolName ?? "Unknown tool");
    case "worktree.create":
      return String(p.worktreeName ?? "worktree");
    case "worktree.remove":
      return String(p.worktreePath ?? "worktree");
    case "config.change":
      return String(p.filePath ?? p.source ?? "config");
    case "compact.complete": {
      const reduction = Number(p.reductionPercent ?? 0);
      const before = Number(p.tokensBefore ?? 0);
      return before > 0
        ? `${before.toLocaleString()} tokens (${reduction}% reduction)`
        : "Context compacted";
    }
    case "elicitation.request":
      return `MCP: ${String(p.mcpServerName ?? "server")}`;
    case "elicitation.response": {
      const dur = Number(p.duration ?? 0);
      const server = String(p.mcpServerName ?? "server");
      return dur > 0
        ? `${server} (${dur > 1000 ? `${(dur / 1000).toFixed(1)}s` : `${dur}ms`})`
        : server;
    }
    case "instructions.loaded": {
      const files = Array.isArray(p.files) ? p.files : [];
      return `${files.length} file${files.length !== 1 ? "s" : ""} loaded`;
    }
    case "teammate.idle":
      return String(p.teammateName ?? "agent") + (p.idleReason ? ` (${String(p.idleReason)})` : "");
    default:
      return event.eventType;
  }
}

export function EventCard({ event }: { event: DevscopeEvent }) {
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
