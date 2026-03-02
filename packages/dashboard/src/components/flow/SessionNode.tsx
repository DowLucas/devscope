import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion } from "motion/react";
import { navigate } from "wouter/use-browser-location";
import type { SessionNodeData } from "./flowTypes";
import type { SessionActivityState } from "./flowTypes";
import type { PromptEventPayload, AgentEventPayload } from "@devscope/shared";
import { ShieldOff } from "lucide-react";
import { ActivityBadge } from "./ActivityBadge";
import { useDebouncedToolState } from "@/hooks/useDebouncedToolState";
import { timeAgo } from "@/lib/utils";

const EVENT_LABELS: Record<string, string> = {
  "session.start": "Session started",
  "session.end": "Session ended",
  "prompt.submit": "Prompt submitted",
  "tool.start": "Tool running",
  "tool.complete": "Tool completed",
  "tool.fail": "Tool failed",
  "agent.start": "Agent spawned",
  "agent.stop": "Agent stopped",
  "response.complete": "Response complete",
  "notification": "Notification",
  "compact.pending": "Compacting Context",
  "task.completed": "Task Completed",
  "permission.request": "Permission Request",
  "worktree.create": "Worktree Created",
  "worktree.remove": "Worktree Removed",
  "config.change": "Config Changed",
};

const EVENT_COLORS: Record<string, string> = {
  "prompt.submit": "text-blue-400 bg-blue-500/15",
  "tool.start": "text-amber-400 bg-amber-500/15",
  "tool.complete": "text-gray-400 bg-gray-500/15",
  "tool.fail": "text-red-400 bg-red-500/15",
  "agent.start": "text-purple-400 bg-purple-500/15",
  "agent.stop": "text-purple-400 bg-purple-500/15",
  "session.start": "text-emerald-400 bg-emerald-500/15",
  "session.end": "text-gray-400 bg-gray-500/15",
  "response.complete": "text-gray-400 bg-gray-500/15",
  "notification": "text-yellow-400 bg-yellow-500/15",
  "compact.pending": "text-orange-400 bg-orange-500/15",
  "task.completed": "text-teal-400 bg-teal-500/15",
  "permission.request": "text-rose-400 bg-rose-500/15",
  "worktree.create": "text-indigo-400 bg-indigo-500/15",
  "worktree.remove": "text-indigo-400 bg-indigo-500/15",
  "config.change": "text-slate-400 bg-slate-500/15",
};

const STATE_CONFIG: Record<SessionActivityState, {
  label: string;
  badgeClass: string;
  borderColor: string;
  pulse: boolean;
}> = {
  running: {
    label: "Running",
    badgeClass: "bg-amber-500/15 text-amber-400",
    borderColor: "rgba(245, 158, 11, 0.4)",
    pulse: true,
  },
  thinking: {
    label: "Thinking",
    badgeClass: "bg-blue-500/15 text-blue-400",
    borderColor: "rgba(59, 130, 246, 0.4)",
    pulse: true,
  },
  waiting: {
    label: "Waiting",
    badgeClass: "bg-orange-500/15 text-orange-400",
    borderColor: "rgba(249, 115, 22, 0.4)",
    pulse: true,
  },
  compacting: {
    label: "Compacting",
    badgeClass: "bg-purple-500/15 text-purple-400",
    borderColor: "rgba(168, 85, 247, 0.4)",
    pulse: true,
  },
  idle: {
    label: "Idle",
    badgeClass: "bg-emerald-500/15 text-emerald-400",
    borderColor: "rgba(16, 185, 129, 0.4)",
    pulse: false,
  },
  ended: {
    label: "Ended",
    badgeClass: "bg-gray-700 text-gray-400",
    borderColor: "rgba(55, 65, 81, 1)",
    pulse: false,
  },
};

const STATE_PULSE_COLORS: Record<string, string> = {
  running: "bg-amber-400",
  thinking: "bg-blue-400",
  waiting: "bg-orange-400",
  compacting: "bg-purple-400",
};

export function SessionNode({ data }: NodeProps & { data: SessionNodeData }) {
  const { session, developerName, latestEvent, isToolRunning, currentToolName, activityState } = data;
  const projectName = session.projectName ?? "";
  const startedAt = session.startedAt ?? "";
  const isDangerousMode = session.permissionMode === "dangerously-skip-permissions";

  const debounced = useDebouncedToolState(isToolRunning, currentToolName, latestEvent);

  // Use debounced tool state to refine the activity state display
  const displayState: SessionActivityState =
    debounced.isToolRunning ? "running" : activityState;

  const stateConfig = STATE_CONFIG[displayState];

  let activityLabel = "";
  let activityColor = "text-gray-500 bg-gray-500/10";

  if (debounced.displayEvent) {
    const eventType = debounced.displayEvent.eventType;
    activityColor = EVENT_COLORS[eventType] ?? "text-gray-400 bg-gray-500/10";

    if (debounced.isToolRunning && debounced.currentToolName) {
      activityLabel = debounced.currentToolName;
      activityColor = EVENT_COLORS["tool.start"];
    } else if (eventType === "prompt.submit") {
      const payload = debounced.displayEvent.payload as PromptEventPayload;
      activityLabel = payload.promptText || `Prompt (${payload.promptLength ?? 0} chars)`;
    } else if (eventType === "agent.start" || eventType === "agent.stop") {
      const payload = debounced.displayEvent.payload as AgentEventPayload;
      activityLabel = payload.agentType ?? "agent";
    } else {
      activityLabel = EVENT_LABELS[eventType] ?? eventType;
    }
  }

  return (
    <motion.div
      onClick={() => { navigate(`/dashboard/sessions/${session.id}`); }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, borderColor: stateConfig.borderColor }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      className="rounded-xl border bg-gray-900 px-4 py-3 shadow-lg cursor-pointer hover:brightness-110"
      style={{ width: 280, borderWidth: 1 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-600" />

      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-sm font-medium text-gray-100">
            <span className="truncate">{projectName}</span>
            {isDangerousMode && (
              <span title="Permissions skipped">
                <ShieldOff className="h-3.5 w-3.5 shrink-0 text-red-400" />
              </span>
            )}
          </div>
          <div className="truncate text-xs text-gray-500">
            {developerName}
          </div>
        </div>
        <span
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${stateConfig.badgeClass}`}
        >
          {stateConfig.pulse && (
            <motion.span
              className={`h-1.5 w-1.5 rounded-full ${STATE_PULSE_COLORS[displayState] ?? "bg-gray-400"}`}
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          {stateConfig.label}
        </span>
      </div>

      <div className="mt-1 text-xs text-gray-600">
        {startedAt ? timeAgo(startedAt) : ""}
      </div>

      <ActivityBadge
        isToolRunning={debounced.isToolRunning}
        activityLabel={activityLabel}
        activityColor={activityColor}
        displayEvent={debounced.displayEvent}
      />

      <Handle type="source" position={Position.Bottom} className="!bg-gray-600" />
    </motion.div>
  );
}
