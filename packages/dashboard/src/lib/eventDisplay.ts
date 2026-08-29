import type { DevscopeEvent } from "@devscope/shared";

/**
 * Presentation for every event type the backend accepts.
 *
 * Extracted from EventCard so the live feed and the card render the same label
 * and summary for a given event instead of drifting apart. Keep these maps in
 * step with the `eventType` enum in
 * `packages/backend/src/routes/events.ts` — anything missing here still renders,
 * it just falls back to the raw event type and a neutral colour.
 */

export const EVENT_COLORS: Record<string, string> = {
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
  // Added in plugin 0.15.0
  "tool.batch": "border-amber-500/30 bg-amber-500/5",
  "prompt.expansion": "border-blue-500/30 bg-blue-500/5",
  "response.failed": "border-red-500/50 bg-red-500/5",
  "model.switch": "border-fuchsia-500/50 bg-fuchsia-500/5",
  "permission.denied": "border-rose-500/50 bg-rose-500/5",
  "task.created": "border-teal-500/30 bg-teal-500/5",
  "cwd.change": "border-slate-500/30 bg-slate-500/5",
  "directory.added": "border-slate-500/30 bg-slate-500/5",
  "plugin.setup": "border-sky-500/30 bg-sky-500/5",
};

export const EVENT_LABELS: Record<string, string> = {
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
  // Added in plugin 0.15.0
  "tool.batch": "Tool Batch",
  "prompt.expansion": "Command Expanded",
  "response.failed": "Response Failed",
  "model.switch": "Model Switched",
  "permission.denied": "Permission Denied",
  "task.created": "Task Created",
  "cwd.change": "Directory Changed",
  "directory.added": "Directory Added",
  "plugin.setup": "Plugin Setup",
};

export function getEventSummary(event: DevscopeEvent): string {
  const p = event.payload as unknown as Record<string, unknown>;
  switch (event.eventType) {
    case "tool.start":
    case "tool.complete":
    case "tool.fail": {
      const tn = String(p.toolName ?? "Unknown tool");
      const sub = p.toolSubcommand ?? p.tool_subcommand;
      return sub ? `${tn} · ${String(sub)}` : tn;
    }
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
      const reduction = Number(p.reductionPercent ?? p.reduction_percent ?? 0);
      const before = Number(p.tokensBefore ?? p.tokens_before ?? 0);
      return before > 0
        ? `${before.toLocaleString()} tokens (${reduction}% reduction)`
        : "Context compacted";
    }
    case "elicitation.request":
      return `MCP: ${String(p.mcpServerName ?? p.mcp_server_name ?? "server")}`;
    case "elicitation.response": {
      const dur = Number(p.duration ?? 0);
      const server = String(p.mcpServerName ?? p.mcp_server_name ?? "server");
      return dur > 0
        ? `${server} (${dur > 1000 ? `${(dur / 1000).toFixed(1)}s` : `${dur}ms`})`
        : server;
    }
    case "instructions.loaded": {
      const files = Array.isArray(p.files) ? p.files : [];
      return `${files.length} file${files.length !== 1 ? "s" : ""} loaded`;
    }
    case "teammate.idle": {
      const name = String(p.teammateName ?? p.teammate_name ?? "agent");
      const reason = p.idleReason ?? p.idle_reason;
      return name + (reason ? ` (${String(reason)})` : "");
    }
    case "tool.batch": {
      const names = Array.isArray(p.toolNames) ? (p.toolNames as unknown[]) : [];
      const size = Number(p.batchSize ?? names.length);
      const preview = names.slice(0, 3).map(String).join(", ");
      return preview
        ? `${size} call${size !== 1 ? "s" : ""} · ${preview}${names.length > 3 ? "…" : ""}`
        : `${size} call${size !== 1 ? "s" : ""}`;
    }
    case "prompt.expansion": {
      const name = String(p.commandName ?? "command");
      return p.expansionType === "mcp_prompt" ? `MCP prompt: ${name}` : `/${name}`;
    }
    case "response.failed":
      return String(p.error ?? "Response failed");
    case "model.switch": {
      const from = String(p.fromModel ?? "");
      const to = String(p.toModel ?? "");
      const via = p.source ? ` (${String(p.source)})` : "";
      return from && to ? `${from} → ${to}${via}` : to || "Model switched";
    }
    case "permission.denied": {
      const tn = String(p.toolName ?? "Unknown tool");
      const sub = p.toolSubcommand;
      return sub ? `${tn} · ${String(sub)}` : tn;
    }
    case "task.created":
      return String(p.taskSubject ?? "Task");
    case "cwd.change":
      return String(p.newCwd ?? "directory");
    case "directory.added":
      return String(p.directory ?? "directory");
    case "plugin.setup":
      return "Trigger: " + String(p.trigger ?? "init");
    default:
      return event.eventType;
  }
}
