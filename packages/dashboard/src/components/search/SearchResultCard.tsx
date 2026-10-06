import { Link } from "wouter";
import { MessageSquare, Bot } from "lucide-react";
import type { SearchHit } from "@devscope/shared";
import { Badge } from "@/components/ui/badge";
import { ProjectLabel } from "@/components/ProjectLabel";
import { timeAgo } from "@/lib/utils";

/** Renders a snippet whose matched terms the API wrapped in « ». */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/«|»/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-yellow-300/40 px-0.5 text-foreground dark:bg-yellow-500/30">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function SearchResultCard({ hit }: { hit: SearchHit }) {
  const href = `/dashboard/sessions/${encodeURIComponent(hit.sessionId)}?turn=${encodeURIComponent(hit.promptEventId)}`;
  return (
    <Link
      href={href}
      className="block rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-accent/30"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="truncate font-medium text-foreground">{hit.sessionTitle ?? "Untitled session"}</span>
        <span>·</span>
        <ProjectLabel name={hit.projectName} />
        <span>·</span>
        <span title={new Date(hit.promptAt).toLocaleString()}>{timeAgo(hit.promptAt)}</span>
        <span className="ml-auto flex gap-1">
          {hit.matchedBy.map((m) => (
            <Badge key={m} variant="outline" className="px-1.5 py-0 text-[10px]">
              {m === "keyword" ? "exact" : "meaning"}
            </Badge>
          ))}
        </span>
      </div>

      <div className="mt-2 flex gap-2 text-sm">
        <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
        <p className="line-clamp-3 whitespace-pre-wrap break-words">
          <Highlighted text={hit.promptSnippet} />
        </p>
      </div>

      {hit.responseSnippet && (
        <div className="mt-2 flex gap-2 text-sm text-muted-foreground">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-purple-400" />
          <p className="line-clamp-3 whitespace-pre-wrap break-words">
            <Highlighted text={hit.responseSnippet} />
          </p>
        </div>
      )}
    </Link>
  );
}
