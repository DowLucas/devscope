import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion } from "motion/react";
import type { AgentNodeData } from "./flowTypes";
import { ActivityBadge } from "./ActivityBadge";
import { useDebouncedToolState } from "@/hooks/useDebouncedToolState";
import { timeAgo } from "@/lib/utils";

const EVENT_LABELS: Record<string, string> = {
  "tool.start": "Tool running",
  "tool.complete": "Tool completed",
  "tool.fail": "Tool failed",
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

const EVENT_COLORS: Record<string, string> = {
  "tool.start": "text-amber-400 bg-amber-500/15",
  "tool.complete": "text-gray-400 bg-gray-500/15",
  "tool.fail": "text-red-400 bg-red-500/15",
  "notification": "text-yellow-400 bg-yellow-500/15",
  "compact.pending": "text-orange-400 bg-orange-500/15",
  "task.completed": "text-teal-400 bg-teal-500/15",
  "permission.request": "text-rose-400 bg-rose-500/15",
  "worktree.create": "text-indigo-400 bg-indigo-500/15",
  "worktree.remove": "text-indigo-400 bg-indigo-500/15",
  "config.change": "text-slate-400 bg-slate-500/15",
  "compact.complete": "text-orange-400 bg-orange-500/15",
  "elicitation.request": "text-violet-400 bg-violet-500/15",
  "elicitation.response": "text-violet-400 bg-violet-500/15",
  "instructions.loaded": "text-sky-400 bg-sky-500/15",
  "teammate.idle": "text-gray-400 bg-gray-500/15",
};

export function AgentNode({ data }: NodeProps & { data: AgentNodeData }) {
  const { agentId, agentType, startedAt, latestEvent, isToolRunning, currentToolName, isStopped } = data;

  const debounced = useDebouncedToolState(isToolRunning, currentToolName, latestEvent);

  let activityLabel = "";
  let activityColor = "text-gray-500 bg-gray-500/10";

  if (debounced.displayEvent) {
    const eventType = debounced.displayEvent.eventType;
    activityColor = EVENT_COLORS[eventType] ?? "text-gray-400 bg-gray-500/10";

    if (debounced.isToolRunning && debounced.currentToolName) {
      activityLabel = debounced.currentToolName;
      activityColor = EVENT_COLORS["tool.start"];
    } else {
      activityLabel = EVENT_LABELS[eventType] ?? eventType;
    }
  }

  const borderColor = isStopped
    ? "rgba(34, 197, 94, 0.4)"   // green-500/40
    : debounced.isToolRunning
      ? "rgba(245, 158, 11, 0.4)"  // amber-500/40
      : "rgba(168, 85, 247, 0.4)"; // purple-500/40

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1, borderColor }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      className="rounded-xl border bg-gray-900 px-3 py-2 shadow-lg"
      style={{ width: 240, borderWidth: 1 }}
    >
      <Handle type="target" position={Position.Top} className={isStopped ? "!bg-green-500" : "!bg-purple-500"} />

      <div className="flex items-center gap-2">
        {isStopped ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-green-400" />
        ) : (
          <motion.span
            className="h-2 w-2 shrink-0 rounded-full bg-purple-400"
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <span className={`truncate text-sm font-medium ${isStopped ? "text-green-200" : "text-purple-200"}`}>
          {agentType}
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
        <span className="font-mono">{agentId?.slice(0, 8) ?? "—"}</span>
        <span>{startedAt ? timeAgo(startedAt) : ""}</span>
      </div>

      <ActivityBadge
        isToolRunning={debounced.isToolRunning}
        activityLabel={activityLabel}
        activityColor={activityColor}
        displayEvent={debounced.displayEvent}
      />

      <Handle type="source" position={Position.Bottom} className={isStopped ? "!bg-green-500" : "!bg-purple-500"} />
    </motion.div>
  );
}
