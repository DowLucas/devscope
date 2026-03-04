import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MessageSquare, ChevronDown, ChevronRight, Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ToolChainTimeline } from "./ToolChainTimeline";
import type { SessionTurn } from "@devscope/shared";
import { parseUTC } from "@/lib/utils";

const PREVIEW_LENGTH = 300;

function ResponseTextBlock({ text }: { text: string }) {
  const [showFull, setShowFull] = useState(false);
  const isLong = text.length > PREVIEW_LENGTH;
  const displayed = isLong && !showFull ? text.slice(0, PREVIEW_LENGTH) + "…" : text;

  return (
    <div className="mt-2 rounded-md bg-muted/40 border border-border px-3 py-2 text-sm text-foreground/80">
      <AnimatePresence initial={false}>
        <motion.p
          key={showFull ? "full" : "preview"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="whitespace-pre-wrap break-words"
        >
          {displayed}
        </motion.p>
      </AnimatePresence>
      {isLong && (
        <button
          onClick={() => setShowFull(!showFull)}
          className="mt-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          {showFull ? "Show less" : "Show full"}
        </button>
      )}
    </div>
  );
}

interface SessionTurnCardProps {
  turn: SessionTurn;
  index: number;
  isSelfView?: boolean;
}

export function SessionTurnCard({ turn, index, isSelfView = false }: SessionTurnCardProps) {
  const [expanded, setExpanded] = useState(index === 0);

  const successCount = turn.toolCalls.filter((t) => t.success === true).length;
  const failCount = turn.toolCalls.filter((t) => t.success === false).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className="border border-border rounded-lg bg-card"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-foreground min-w-0 flex-1">
          <MessageSquare className="h-4 w-4 text-blue-400 shrink-0" />
          {turn.prompt ? (
            <span className="truncate">
              {turn.prompt.content.length > 100
                ? turn.prompt.content.slice(0, 100) + "..."
                : turn.prompt.content}
            </span>
          ) : (
            <span className="text-muted-foreground italic">No prompt</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {turn.toolCalls.length > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {turn.toolCalls.length} tool{turn.toolCalls.length !== 1 ? "s" : ""}
            </Badge>
          )}
          {failCount > 0 && (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
              {failCount} fail
            </Badge>
          )}
          {turn.agents.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-purple-400">
              {turn.agents.length} agent{turn.agents.length !== 1 ? "s" : ""}
            </Badge>
          )}
          {expanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {turn.prompt && (
            <div className="rounded-lg bg-muted/50 border border-border px-3 py-2">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {turn.prompt.content}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {parseUTC(turn.prompt.timestamp).toLocaleTimeString()}
              </p>
            </div>
          )}

          {turn.toolCalls.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1 font-medium">
                Tool Chain ({successCount} ok, {failCount} fail)
              </p>
              <ToolChainTimeline toolCalls={turn.toolCalls} isSelfView={isSelfView} />
            </div>
          )}

          {turn.agents.length > 0 && (
            <div className="space-y-1">
              {turn.agents.map((agent, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground ml-4">
                  <Bot className="h-3 w-3 text-purple-400" />
                  <span>{agent.action === "start" ? "Started" : "Stopped"} {agent.agentType}</span>
                  <span className="ml-auto">{parseUTC(agent.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}

          {turn.response && (
            <div className="border-t border-border pt-2 space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Response</span>
                {turn.response.responseLength != null && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    {(turn.response.responseLength / 1000).toFixed(1)}k chars
                  </Badge>
                )}
                <span className="ml-auto">{parseUTC(turn.response.timestamp).toLocaleTimeString()}</span>
              </div>
              {isSelfView && turn.response.responseText && (
                <ResponseTextBlock text={turn.response.responseText} />
              )}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
