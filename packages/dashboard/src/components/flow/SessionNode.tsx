import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion } from "motion/react";
import type { SessionNodeData } from "./flowTypes";
import type { SessionActivityState } from "./flowTypes";
import { STATE_CONFIG, STATE_PULSE_COLORS } from "./sessionStates";
import type { PromptEventPayload, AgentEventPayload } from "@devscope/shared";
import { ShieldOff, Lock, GitBranch } from "lucide-react";
import { ActivityBadge } from "./ActivityBadge";
import { useDebouncedToolState } from "@/hooks/useDebouncedToolState";
import { formatCost, formatTokenCount, sessionTokenTotal, timeAgo } from "@/lib/utils";
import { ProjectLabel } from "@/components/ProjectLabel";

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
  "compact.complete": "Context Compacted",
  "elicitation.request": "MCP Elicitation",
  "elicitation.response": "Elicitation Response",
  "instructions.loaded": "Instructions Loaded",
  "teammate.idle": "Teammate Idle",
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
  "compact.complete": "text-orange-400 bg-orange-500/15",
  "elicitation.request": "text-violet-400 bg-violet-500/15",
  "elicitation.response": "text-violet-400 bg-violet-500/15",
  "instructions.loaded": "text-sky-400 bg-sky-500/15",
  "teammate.idle": "text-gray-400 bg-gray-500/15",
};

/** "claude-opus-5-5" → "opus-5-5", short enough for a card. */
function shortModel(model: string | null | undefined): string | null {
  return model ? model.replace(/^claude-/, "") : null;
}

export function SessionNode({ data, selected }: NodeProps & { data: SessionNodeData }) {
  const { session, latestEvent, isToolRunning, currentToolName, activityState, lastActivityAt, toolCalls, toolFailures } = data;
  // Usage is only returned for the viewer's own sessions.
  const usage = session.tokenSource != null
    ? `${formatTokenCount(sessionTokenTotal(session))} tok · ${formatCost(session.estimatedCostUsd ?? 0)}`
    : null;
  const meta = [shortModel(session.model), usage].filter(Boolean).join(" · ");
  const isDangerousMode = session.permissionMode === "dangerously-skip-permissions";
  const isRedactedMode = session.privacyMode === "private";

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
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: displayState === "inactive" ? 0.55 : 1, y: 0, borderColor: stateConfig.borderColor }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      className={`rounded-xl border bg-gray-900 px-4 py-3 shadow-lg cursor-pointer hover:brightness-110 ${selected ? "ring-2 ring-blue-400/60" : ""}`}
      style={{ width: 280, borderWidth: 1 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-600" />

      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-sm font-medium text-gray-100">
            <ProjectLabel name={session.projectName} className="truncate" />
            {isDangerousMode && (
              <span title="Permissions skipped">
                <ShieldOff className="h-3.5 w-3.5 shrink-0 text-red-400" />
              </span>
            )}
            {isRedactedMode && (
              <span title="Privacy mode (private)">
                <Lock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              </span>
            )}
          </div>
          {session.currentTitle ? (
            <div className="truncate text-xs italic text-gray-400">
              {session.currentTitle}
            </div>
          ) : null}
          {session.gitBranch ? (
            <div className="flex min-w-0 items-center gap-1 text-xs text-gray-500" title={session.gitBranch}>
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate font-mono">{session.gitBranch}</span>
            </div>
          ) : null}
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

      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-600">
        <span>active {timeAgo(lastActivityAt)}</span>
        {toolCalls != null ? (
          <span>
            {toolCalls} tools
            {toolFailures ? <span className="text-red-400"> · {toolFailures} failed</span> : null}
          </span>
        ) : null}
      </div>
      {meta ? <div className="truncate text-xs text-gray-500">{meta}</div> : null}

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
