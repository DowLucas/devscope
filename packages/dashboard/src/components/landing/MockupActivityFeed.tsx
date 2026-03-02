import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Play,
  MessageSquare,
  Wrench,
  Bot,
  CheckCircle2,
  Square,
  AlertTriangle,
  Bell,
  GitBranch,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Infinite-streaming activity feed mockup for the landing page hero  */
/*  Generates random developer events forever — no loops, no resets.   */
/* ------------------------------------------------------------------ */

const DEVELOPERS = ["Lucas S", "Sarah K", "Alex M", "Jordan P"] as const;
const PROJECTS = ["devscope", "api-gateway", "auth-service", "web-app", "cli-tools"] as const;
const TOOLS = ["Read", "Grep", "Edit", "Write", "Bash", "Glob", "WebFetch"] as const;
const AGENTS = ["code-reviewer", "test-runner", "debugger", "explorer"] as const;
const PROMPTS = [
  "Refactor the auth middleware to use JWT validation",
  "Add pagination to the users endpoint",
  "Fix the race condition in the WebSocket handler",
  "Update the CI pipeline to run tests in parallel",
  "Implement rate limiting on the API routes",
  "Migrate the database schema to support multi-tenancy",
  "Add error boundaries to the dashboard components",
  "Optimize the query for fetching session history",
] as const;
const TASKS = [
  "Update auth tests",
  "Fix flaky CI build",
  "Add input validation",
  "Refactor DB queries",
  "Write migration script",
] as const;

type EventKind =
  | "session-start"
  | "prompt"
  | "tools"
  | "agent"
  | "task"
  | "session-end"
  | "alert"
  | "notification"
  | "worktree";

interface FeedEvent {
  id: number;
  kind: EventKind;
  developer: string;
  project: string;
  detail: string;
  /** Timestamp when this event was created (epoch ms). */
  createdAt: number;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Format seconds into a human-friendly relative time string. */
function formatTime(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function randomToolList(): string {
  const count = 2 + Math.floor(Math.random() * 4);
  const shuffled = [...TOOLS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).join(", ");
}

let nextId = 0;

function generateEvent(): FeedEvent {
  const dev = pick(DEVELOPERS);
  const proj = pick(PROJECTS);
  const kinds: EventKind[] = [
    "prompt", "prompt", "prompt",      // weighted heavier
    "tools", "tools", "tools",
    "agent", "agent",
    "task",
    "session-start",
    "session-end",
    "notification",
    "worktree",
  ];
  const kind = pick(kinds);

  let detail = "";
  switch (kind) {
    case "session-start":
      detail = proj;
      break;
    case "session-end":
      detail = proj;
      break;
    case "prompt":
      detail = pick(PROMPTS);
      break;
    case "tools":
      detail = randomToolList();
      break;
    case "agent":
      detail = pick(AGENTS);
      break;
    case "task":
      detail = pick(TASKS);
      break;
    case "notification":
      detail = "Build succeeded";
      break;
    case "worktree":
      detail = `feature/${proj}-${Math.floor(Math.random() * 100)}`;
      break;
  }

  return { id: nextId++, kind, developer: dev, project: proj, detail, createdAt: Date.now() };
}

/** Max visible items before oldest are trimmed. */
const MAX_VISIBLE = 5;
/** Ms between new events. */
const INTERVAL = 1600;

/* ----- Rendering helpers per event kind ----- */

function dotProps(kind: EventKind) {
  switch (kind) {
    case "session-start":
      return { color: "bg-emerald-600", Icon: Play, iconClass: "text-white" };
    case "session-end":
      return { color: "bg-muted", Icon: Square, iconClass: "text-muted-foreground" };
    case "prompt":
      return { color: "bg-blue-600", Icon: MessageSquare, iconClass: "text-white" };
    case "tools":
      return { color: "bg-muted", Icon: Wrench, iconClass: "text-muted-foreground" };
    case "agent":
      return { color: "bg-purple-600", Icon: Bot, iconClass: "text-white" };
    case "task":
      return { color: "bg-teal-600", Icon: CheckCircle2, iconClass: "text-white" };
    case "alert":
      return { color: "bg-destructive", Icon: AlertTriangle, iconClass: "text-white" };
    case "notification":
      return { color: "bg-yellow-600", Icon: Bell, iconClass: "text-white" };
    case "worktree":
      return { color: "bg-indigo-600", Icon: GitBranch, iconClass: "text-white" };
  }
}

function EventContent({ event }: { event: FeedEvent }) {
  switch (event.kind) {
    case "session-start":
      return (
        <span className="truncate">
          <span className="font-medium text-foreground">{event.developer}</span>
          {" started working on "}
          <span className="font-mono text-[10px] text-muted-foreground">{event.detail}</span>
        </span>
      );
    case "session-end":
      return (
        <span className="truncate">
          <span className="font-medium text-foreground">{event.developer}</span>
          {" ended session in "}
          <span className="font-mono text-[10px] text-muted-foreground">{event.detail}</span>
        </span>
      );
    case "tools":
      return (
        <span className="truncate">
          Used tools: <span className="text-foreground/70">{event.detail}</span>
        </span>
      );
    case "agent":
      return (
        <span className="truncate">
          <span className="font-medium text-foreground">{event.developer}</span>
          {" spawned "}
          <span className="rounded bg-purple-500/20 px-1 py-0.5 text-[9px] font-medium text-purple-400">
            {event.detail}
          </span>
        </span>
      );
    case "task":
      return (
        <span className="truncate">
          <span className="font-medium text-foreground">{event.developer}</span>
          {" completed "}
          <span className="font-medium text-teal-400">{event.detail}</span>
        </span>
      );
    case "notification":
      return (
        <span className="truncate">
          <span className="font-medium text-yellow-400">{event.detail}</span>
          {" — "}
          <span className="text-muted-foreground">{event.project}</span>
        </span>
      );
    case "worktree":
      return (
        <span className="truncate">
          <span className="font-medium text-foreground">{event.developer}</span>
          {" created worktree "}
          <span className="font-mono text-[10px] text-indigo-400">{event.detail}</span>
        </span>
      );
    default:
      return null;
  }
}

export function MockupActivityFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [now, setNow] = useState(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    // Seed with one immediate event
    setEvents([generateEvent()]);

    // Add new events on interval
    intervalRef.current = setInterval(() => {
      setEvents((prev) => {
        const next = [generateEvent(), ...prev];
        return next.slice(0, MAX_VISIBLE);
      });
    }, INTERVAL);

    // Tick `now` every second so relative times stay accurate
    const tickId = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      clearInterval(intervalRef.current);
      clearInterval(tickId);
    };
  }, []);

  return (
    <div className="px-5 py-4 h-[380px] overflow-hidden">
      <AnimatePresence initial={false}>
        {events.map((event, i) => {
          const { color, Icon, iconClass } = dotProps(event.kind);
          const isLast = i === events.length - 1;
          const isPrompt = event.kind === "prompt";
          const elapsed = Math.max(0, Math.round((now - event.createdAt) / 1000));
          const timeLabel = formatTime(elapsed);

          return (
            <motion.div
              key={event.id}
              layout="position"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6, transition: { duration: 0.35, ease: "easeInOut" } }}
              transition={{
                opacity: { duration: 0.4, ease: "easeOut" },
                y: { duration: 0.4, ease: "easeOut" },
                layout: { duration: 0.5, ease: [0.4, 0, 0.2, 1] },
              }}
              className="relative flex gap-3 pb-3"
            >
              {/* Vertical connector line */}
              {!isLast && (
                <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />
              )}

              {/* Dot */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.3, ease: "easeOut", delay: 0.1 }}
                className={`relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full ring-2 ring-background ${color}`}
              >
                <Icon className={`size-3 ${iconClass}`} />
              </motion.div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-0.5">
                {isPrompt ? (
                  <div>
                    <div className="flex items-center gap-1.5 text-xs mb-1">
                      <span className="font-medium text-foreground">{event.developer}</span>
                      <span className="rounded border border-border px-1 py-0 text-[9px] text-muted-foreground">
                        {event.project}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground">{timeLabel}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed rounded-md bg-muted/50 border border-border px-2 py-1.5 line-clamp-2">
                      {event.detail}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <EventContent event={event} />
                    <span className="ml-auto shrink-0 text-[10px]">{timeLabel}</span>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
