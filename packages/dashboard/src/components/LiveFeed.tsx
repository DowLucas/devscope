import { useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { navigate } from "wouter/use-browser-location";
import {
  MessageSquare,
  Play,
  Square,
  AlertTriangle,
  Wrench,
  Bot,
  BotOff,
  Bell,
  Minimize2,
  CheckCircle2,
  ShieldAlert,
  GitBranch,
  Settings,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { Link } from "wouter";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useActivityStore } from "@/stores/activityStore";
import { useListApiKeys } from "@/components/AuthProvider";
import { timeAgo } from "@/lib/utils";
import type { DevscopeEvent } from "@devscope/shared";

// ---------------------------------------------------------------------------
// Feed item types
// ---------------------------------------------------------------------------

type FeedItem =
  | { kind: "prompt"; key: string; event: DevscopeEvent }
  | {
      kind: "tool-summary";
      key: string;
      tools: string[];
      callCount: number;
      timestamp: string;
    }
  | { kind: "lifecycle"; key: string; event: DevscopeEvent }
  | { kind: "tool-fail"; key: string; event: DevscopeEvent }
  | { kind: "agent"; key: string; event: DevscopeEvent }
  | { kind: "notification"; key: string; event: DevscopeEvent }
  | { kind: "compact"; key: string; event: DevscopeEvent }
  | { kind: "task"; key: string; event: DevscopeEvent }
  | { kind: "permission"; key: string; event: DevscopeEvent }
  | { kind: "worktree"; key: string; event: DevscopeEvent }
  | { kind: "config"; key: string; event: DevscopeEvent }
  | { kind: "context-boundary"; key: string; event: DevscopeEvent };

// ---------------------------------------------------------------------------
// Build compacted feed from raw events
// ---------------------------------------------------------------------------

function buildFeedItems(events: DevscopeEvent[]): FeedItem[] {
  const items: FeedItem[] = [];
  let toolBatch: DevscopeEvent[] = [];

  function flushTools() {
    if (toolBatch.length === 0) return;
    const toolNames: string[] = [];
    let callCount = 0;
    for (const e of toolBatch) {
      const p = e.payload as unknown as Record<string, unknown>;
      const name = String(p.toolName ?? "Unknown");
      if (e.eventType === "tool.start") {
        callCount++;
        if (!toolNames.includes(name)) toolNames.push(name);
      } else if (
        e.eventType === "tool.complete" &&
        !toolNames.includes(name)
      ) {
        toolNames.push(name);
      }
    }
    if (callCount === 0) callCount = toolBatch.length;
    items.push({
      kind: "tool-summary",
      key: "tools-" + toolBatch[toolBatch.length - 1].id,
      tools: toolNames,
      callCount,
      timestamp: toolBatch[0].timestamp,
    });
    toolBatch = [];
  }

  for (const event of events) {
    switch (event.eventType) {
      case "response.complete":
        break;
      case "tool.start":
      case "tool.complete":
        toolBatch.push(event);
        break;
      case "tool.fail":
        flushTools();
        items.push({ kind: "tool-fail", key: event.id, event });
        break;
      case "prompt.submit":
        flushTools();
        items.push({ kind: "prompt", key: event.id, event });
        break;
      case "session.start": {
        flushTools();
        const startPayload = event.payload as unknown as Record<string, unknown>;
        if (startPayload.continued) {
          items.push({ kind: "context-boundary", key: event.id, event });
        } else {
          items.push({ kind: "lifecycle", key: event.id, event });
        }
        break;
      }
      case "session.end": {
        flushTools();
        const endPayload = event.payload as unknown as Record<string, unknown>;
        const endReason = String(endPayload.endReason ?? "");
        const isContinuation = ["clear", "resume", "compact"].includes(endReason);
        if (!isContinuation) {
          items.push({ kind: "lifecycle", key: event.id, event });
        }
        // Continuation session.end events are silently skipped
        break;
      }
      case "agent.start":
      case "agent.stop":
        flushTools();
        items.push({ kind: "agent", key: event.id, event });
        break;
      case "notification":
        flushTools();
        items.push({ kind: "notification", key: event.id, event });
        break;
      case "compact.pending":
        flushTools();
        items.push({ kind: "compact", key: event.id, event });
        break;
      case "task.completed":
        flushTools();
        items.push({ kind: "task", key: event.id, event });
        break;
      case "permission.request":
        flushTools();
        items.push({ kind: "permission", key: event.id, event });
        break;
      case "worktree.create":
      case "worktree.remove":
        flushTools();
        items.push({ kind: "worktree", key: event.id, event });
        break;
      case "config.change":
        flushTools();
        items.push({ kind: "config", key: event.id, event });
        break;
    }
  }
  // Don't flush trailing tool batch — only show tool summaries
  // between meaningful events, not while tools are actively running.
  return items;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ---------------------------------------------------------------------------
// Timeline node — wraps every feed item with the vertical line + dot
// ---------------------------------------------------------------------------

function TimelineNode({
  dotColor,
  icon,
  isLast,
  children,
}: {
  dotColor: string;
  icon: React.ReactNode;
  isLast: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex gap-4 pb-6">
      {/* Vertical line */}
      {!isLast && (
        <div className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />
      )}
      {/* Dot */}
      <div
        className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-background ${dotColor}`}
      >
        {icon}
      </div>
      {/* Content */}
      <div className="flex-1 min-w-0 pt-0.5">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item renderers
// ---------------------------------------------------------------------------

function PromptItem({
  event,
  isLast,
}: {
  event: DevscopeEvent;
  isLast: boolean;
}) {
  const p = event.payload as unknown as Record<string, unknown>;
  const promptText = p.promptText as string | undefined;
  const label = promptText || `Prompt (${p.promptLength ?? 0} chars)`;

  return (
    <TimelineNode
      dotColor="bg-blue-600"
      icon={<MessageSquare className="h-4 w-4 text-white" />}
      isLast={isLast}
    >
      <div className="flex items-center gap-2 mb-1">
        <Avatar size="sm">
          <AvatarFallback className="bg-blue-600/20 text-blue-400 text-[10px]">
            {getInitials(event.developerName)}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium text-foreground">
          {event.developerName}
        </span>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {event.projectName}
        </Badge>
        <button
          onClick={() => { navigate(`/dashboard/sessions/${event.sessionId}`); }}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="View session"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          {timeAgo(event.timestamp)}
        </span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed mt-1 rounded-lg bg-muted/50 border border-border px-3 py-2 line-clamp-3">
        {label}
      </p>
    </TimelineNode>
  );
}

function ToolSummaryItem({
  tools,
  callCount,
  timestamp,
  isLast,
}: {
  tools: string[];
  callCount: number;
  timestamp: string;
  isLast: boolean;
}) {
  return (
    <TimelineNode
      dotColor="bg-muted"
      icon={<Wrench className="h-3.5 w-3.5 text-muted-foreground" />}
      isLast={isLast}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
        <span>
          Used {callCount} tool{callCount !== 1 ? "s" : ""}:{" "}
          <span className="text-foreground/70">
            {tools.slice(0, 4).join(", ")}
            {tools.length > 4 && ` +${tools.length - 4} more`}
          </span>
        </span>
        <span className="ml-auto">{timeAgo(timestamp)}</span>
      </div>
    </TimelineNode>
  );
}

function LifecycleItem({
  event,
  isLast,
}: {
  event: DevscopeEvent;
  isLast: boolean;
}) {
  const isStart = event.eventType === "session.start";
  return (
    <TimelineNode
      dotColor={isStart ? "bg-emerald-600" : "bg-muted"}
      icon={
        isStart ? (
          <Play className="h-3.5 w-3.5 text-white" />
        ) : (
          <Square className="h-3 w-3 text-muted-foreground" />
        )
      }
      isLast={isLast}
    >
      <div className="flex items-center gap-2 pt-1">
        <span className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {event.developerName}
          </span>
          {isStart ? " started working on " : " ended session in "}
          <span className="font-mono text-xs text-muted-foreground">
            {event.projectName}
          </span>
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {timeAgo(event.timestamp)}
        </span>
      </div>
    </TimelineNode>
  );
}

function ToolFailItem({
  event,
  isLast,
}: {
  event: DevscopeEvent;
  isLast: boolean;
}) {
  const p = event.payload as unknown as Record<string, unknown>;
  return (
    <TimelineNode
      dotColor="bg-destructive"
      icon={<AlertTriangle className="h-3.5 w-3.5 text-white" />}
      isLast={isLast}
    >
      <div className="flex items-center gap-2 pt-1">
        <span className="text-sm text-destructive font-medium">
          Tool failed: {String(p.toolName ?? "Unknown")}
        </span>
        <span className="text-xs text-muted-foreground">
          {event.developerName}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {timeAgo(event.timestamp)}
        </span>
      </div>
    </TimelineNode>
  );
}

function AgentItem({
  event,
  isLast,
}: {
  event: DevscopeEvent;
  isLast: boolean;
}) {
  const p = event.payload as unknown as Record<string, unknown>;
  const isStart = event.eventType === "agent.start";
  return (
    <TimelineNode
      dotColor="bg-purple-600"
      icon={
        isStart ? (
          <Bot className="h-3.5 w-3.5 text-white" />
        ) : (
          <BotOff className="h-3.5 w-3.5 text-white" />
        )
      }
      isLast={isLast}
    >
      <div className="flex items-center gap-2 pt-1">
        <span className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {event.developerName}
          </span>
          {isStart ? " spawned " : " finished "}
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 text-purple-400"
          >
            {String(p.agentType ?? "agent")}
          </Badge>
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {timeAgo(event.timestamp)}
        </span>
      </div>
    </TimelineNode>
  );
}

function ContextBoundaryItem({
  event,
  isLast,
}: {
  event: DevscopeEvent;
  isLast: boolean;
}) {
  const p = event.payload as unknown as Record<string, unknown>;
  const startType = String(p.startType ?? "clear");
  const label =
    startType === "resume"
      ? "Session resumed"
      : startType === "compact"
        ? "Context compacted"
        : "Context cleared";

  return (
    <TimelineNode
      dotColor="bg-amber-600"
      icon={<RefreshCw className="h-3.5 w-3.5 text-white" />}
      isLast={isLast}
    >
      <div className="flex items-center gap-2 pt-1">
        <span className="text-sm text-amber-400 font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          {event.developerName}
        </span>
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-400"
        >
          {event.projectName}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {timeAgo(event.timestamp)}
        </span>
      </div>
    </TimelineNode>
  );
}

function NotificationItem({
  event,
  isLast,
}: {
  event: DevscopeEvent;
  isLast: boolean;
}) {
  const p = event.payload as unknown as Record<string, unknown>;
  return (
    <TimelineNode
      dotColor="bg-yellow-600"
      icon={<Bell className="h-3.5 w-3.5 text-white" />}
      isLast={isLast}
    >
      <div className="flex items-center gap-2 pt-1">
        <span className="text-sm font-medium text-yellow-400">
          {String(p.title ?? "Notification")}
        </span>
        {p.message ? (
          <span className="text-xs text-muted-foreground truncate">
            {String(p.message)}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {timeAgo(event.timestamp)}
        </span>
      </div>
    </TimelineNode>
  );
}

function CompactItem({
  event,
  isLast,
}: {
  event: DevscopeEvent;
  isLast: boolean;
}) {
  const p = event.payload as unknown as Record<string, unknown>;
  return (
    <TimelineNode
      dotColor="bg-orange-600"
      icon={<Minimize2 className="h-3.5 w-3.5 text-white" />}
      isLast={isLast}
    >
      <div className="flex items-center gap-2 pt-1">
        <span className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {event.developerName}
          </span>
          {" compacting context"}
        </span>
        <Badge
          variant="secondary"
          className="text-[10px] px-1.5 py-0 text-orange-400"
        >
          {String(p.trigger ?? "auto")}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {timeAgo(event.timestamp)}
        </span>
      </div>
    </TimelineNode>
  );
}

function TaskItem({
  event,
  isLast,
}: {
  event: DevscopeEvent;
  isLast: boolean;
}) {
  const p = event.payload as unknown as Record<string, unknown>;
  return (
    <TimelineNode
      dotColor="bg-teal-600"
      icon={<CheckCircle2 className="h-3.5 w-3.5 text-white" />}
      isLast={isLast}
    >
      <div className="flex items-center gap-2 pt-1">
        <span className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {event.developerName}
          </span>
          {" completed task "}
          <span className="font-medium text-teal-400">
            {String(p.taskSubject ?? "task")}
          </span>
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {timeAgo(event.timestamp)}
        </span>
      </div>
    </TimelineNode>
  );
}

function PermissionItem({
  event,
  isLast,
}: {
  event: DevscopeEvent;
  isLast: boolean;
}) {
  const p = event.payload as unknown as Record<string, unknown>;
  return (
    <TimelineNode
      dotColor="bg-rose-600"
      icon={<ShieldAlert className="h-3.5 w-3.5 text-white" />}
      isLast={isLast}
    >
      <div className="flex items-center gap-2 pt-1">
        <span className="text-sm text-muted-foreground">
          Permission requested for{" "}
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 text-rose-400"
          >
            {String(p.toolName ?? "unknown")}
          </Badge>
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {timeAgo(event.timestamp)}
        </span>
      </div>
    </TimelineNode>
  );
}

function WorktreeItem({
  event,
  isLast,
}: {
  event: DevscopeEvent;
  isLast: boolean;
}) {
  const p = event.payload as unknown as Record<string, unknown>;
  const isCreate = event.eventType === "worktree.create";
  return (
    <TimelineNode
      dotColor={isCreate ? "bg-indigo-600" : "bg-indigo-600/60"}
      icon={<GitBranch className="h-3.5 w-3.5 text-white" />}
      isLast={isLast}
    >
      <div className="flex items-center gap-2 pt-1">
        <span className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {event.developerName}
          </span>
          {isCreate ? " created worktree " : " removed worktree "}
          <span className="font-mono text-xs text-indigo-400">
            {String(isCreate ? p.worktreeName ?? "" : p.worktreePath ?? "")}
          </span>
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {timeAgo(event.timestamp)}
        </span>
      </div>
    </TimelineNode>
  );
}

function ConfigItem({
  event,
  isLast,
}: {
  event: DevscopeEvent;
  isLast: boolean;
}) {
  const p = event.payload as unknown as Record<string, unknown>;
  return (
    <TimelineNode
      dotColor="bg-slate-600"
      icon={<Settings className="h-3.5 w-3.5 text-white" />}
      isLast={isLast}
    >
      <div className="flex items-center gap-2 pt-1">
        <span className="text-sm text-muted-foreground">
          Config changed:{" "}
          <span className="font-mono text-xs text-foreground/70">
            {String(p.filePath ?? p.source ?? "config")}
          </span>
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {timeAgo(event.timestamp)}
        </span>
      </div>
    </TimelineNode>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LiveFeed() {
  const events = useActivityStore((s) => s.events);
  const feedItems = useMemo(() => buildFeedItems(events), [events]);
  const { data: apiKeys, isPending: keysLoading } = useListApiKeys();

  const hasApiKeys = keysLoading || (apiKeys && apiKeys.length > 0);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-6 text-foreground">Activity</h2>
      {feedItems.length === 0 ? (
        !hasApiKeys ? (
          <Card className="max-w-md mx-auto">
            <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
              <Badge variant="outline" className="text-amber-500 border-amber-500/30">
                Setup Not Complete
              </Badge>
              <p className="text-sm text-muted-foreground">
                Connect the DevScope plugin to start monitoring your Claude Code sessions.
              </p>
              <Link
                href="/onboarding"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Complete Setup
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="text-muted-foreground text-center py-12 text-sm">
            No activity yet. Start a Claude Code session with the DevScope
            plugin.
          </div>
        )
      ) : (
        <AnimatePresence mode="popLayout">
          {feedItems.map((item, i) => {
            const isLast = i === feedItems.length - 1;
            return (
              <motion.div
                key={item.key}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              >
                {item.kind === "prompt" && (
                  <PromptItem event={item.event} isLast={isLast} />
                )}
                {item.kind === "tool-summary" && (
                  <ToolSummaryItem
                    tools={item.tools}
                    callCount={item.callCount}
                    timestamp={item.timestamp}
                    isLast={isLast}
                  />
                )}
                {item.kind === "lifecycle" && (
                  <LifecycleItem event={item.event} isLast={isLast} />
                )}
                {item.kind === "tool-fail" && (
                  <ToolFailItem event={item.event} isLast={isLast} />
                )}
                {item.kind === "agent" && (
                  <AgentItem event={item.event} isLast={isLast} />
                )}
                {item.kind === "notification" && (
                  <NotificationItem event={item.event} isLast={isLast} />
                )}
                {item.kind === "compact" && (
                  <CompactItem event={item.event} isLast={isLast} />
                )}
                {item.kind === "task" && (
                  <TaskItem event={item.event} isLast={isLast} />
                )}
                {item.kind === "permission" && (
                  <PermissionItem event={item.event} isLast={isLast} />
                )}
                {item.kind === "worktree" && (
                  <WorktreeItem event={item.event} isLast={isLast} />
                )}
                {item.kind === "config" && (
                  <ConfigItem event={item.event} isLast={isLast} />
                )}
                {item.kind === "context-boundary" && (
                  <ContextBoundaryItem event={item.event} isLast={isLast} />
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      )}
    </div>
  );
}
