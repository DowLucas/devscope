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
};

const EVENT_COLORS: Record<string, string> = {
  "tool.start": "text-amber-400 bg-amber-500/15",
  "tool.complete": "text-gray-400 bg-gray-500/15",
  "tool.fail": "text-red-400 bg-red-500/15",
};

export function AgentNode({ data }: NodeProps & { data: AgentNodeData }) {
  const { agentId, agentType, startedAt, latestEvent, isToolRunning, currentToolName } = data;

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

  const borderColor = debounced.isToolRunning
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
      <Handle type="target" position={Position.Top} className="!bg-purple-500" />

      <div className="flex items-center gap-2">
        <motion.span
          className="h-2 w-2 shrink-0 rounded-full bg-purple-400"
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
        <span className="truncate text-sm font-medium text-purple-200">
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

      <Handle type="source" position={Position.Bottom} className="!bg-purple-500" />
    </motion.div>
  );
}
