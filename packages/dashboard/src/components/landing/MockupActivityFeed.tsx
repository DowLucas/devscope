import {
  Play,
  MessageSquare,
  Wrench,
  Bot,
  CheckCircle2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Static activity feed mockup for the landing page hero (technical)  */
/* ------------------------------------------------------------------ */

const FEED_ITEMS = [
  {
    dotColor: "bg-emerald-600",
    icon: Play,
    iconClass: "text-white",
    content: (
      <>
        <span className="font-medium text-foreground">Lucas S</span>
        {" started working on "}
        <span className="font-mono text-[10px] text-muted-foreground">
          devscope
        </span>
      </>
    ),
    time: "2m ago",
  },
  {
    dotColor: "bg-blue-600",
    icon: MessageSquare,
    iconClass: "text-white",
    content: null, // prompt — rendered separately with bubble
    promptText: "Refactor the auth middleware to use JWT validation",
    name: "Lucas S",
    project: "devscope",
    time: "1m ago",
  },
  {
    dotColor: "bg-muted",
    icon: Wrench,
    iconClass: "text-muted-foreground",
    content: (
      <>
        Used 3 tools:{" "}
        <span className="text-foreground/70">Read, Grep, Edit</span>
      </>
    ),
    time: "45s ago",
  },
  {
    dotColor: "bg-purple-600",
    icon: Bot,
    iconClass: "text-white",
    content: (
      <>
        <span className="font-medium text-foreground">Lucas S</span>
        {" spawned "}
        <span className="rounded bg-purple-500/20 px-1 py-0.5 text-[9px] font-medium text-purple-400">
          code-reviewer
        </span>
      </>
    ),
    time: "30s ago",
  },
  {
    dotColor: "bg-teal-600",
    icon: CheckCircle2,
    iconClass: "text-white",
    content: (
      <>
        <span className="font-medium text-foreground">Lucas S</span>
        {" completed "}
        <span className="font-medium text-teal-400">Update auth tests</span>
      </>
    ),
    time: "just now",
  },
] as const;

export function MockupActivityFeed() {
  return (
    <div className="px-4 py-3 space-y-0">
      {FEED_ITEMS.map((item, i) => {
        const Icon = item.icon;
        const isLast = i === FEED_ITEMS.length - 1;

        return (
          <div key={i} className="relative flex gap-3 pb-3">
            {/* Vertical connector line */}
            {!isLast && (
              <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />
            )}

            {/* Dot */}
            <div
              className={`relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full ring-2 ring-background ${item.dotColor}`}
            >
              <Icon className={`size-3 ${item.iconClass}`} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pt-0.5">
              {item.content ? (
                /* Simple one-line items */
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="truncate">{item.content}</span>
                  <span className="ml-auto shrink-0 text-[10px]">
                    {item.time}
                  </span>
                </div>
              ) : (
                /* Prompt item with bubble */
                <div>
                  <div className="flex items-center gap-1.5 text-xs mb-1">
                    <span className="font-medium text-foreground">
                      {item.name}
                    </span>
                    <span className="rounded border border-border px-1 py-0 text-[9px] text-muted-foreground">
                      {item.project}
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {item.time}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed rounded-md bg-muted/50 border border-border px-2 py-1.5 line-clamp-2">
                    {item.promptText}
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
