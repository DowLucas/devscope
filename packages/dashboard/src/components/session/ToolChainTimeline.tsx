import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CheckCircle, XCircle, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ToolCallEntry } from "@devscope/shared";

interface ToolChainTimelineProps {
  toolCalls: ToolCallEntry[];
}

function getToolInputSummary(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
      return String(toolInput.file_path ?? "");
    case "Bash":
      return toolInput.description
        ? `${toolInput.description}: ${toolInput.command}`
        : String(toolInput.command ?? "");
    case "Edit":
    case "Write":
      return String(toolInput.file_path ?? "");
    case "Grep": {
      const parts = [String(toolInput.pattern ?? "")];
      if (toolInput.path) parts.push(`in ${toolInput.path}`);
      if (toolInput.glob) parts.push(`(${toolInput.glob})`);
      return parts.join(" ");
    }
    case "Glob":
      return String(toolInput.pattern ?? "");
    case "Agent":
      return [toolInput.subagent_type, toolInput.description]
        .filter(Boolean)
        .join(" — ");
    case "WebSearch":
      return String(toolInput.query ?? "");
    case "WebFetch":
      return String(toolInput.url ?? "");
    default: {
      // Fallback: show all keys with truncated values
      return Object.entries(toolInput)
        .map(([k, v]) => {
          const s = typeof v === "string" ? v : JSON.stringify(v);
          return `${k}: ${s.length > 60 ? s.slice(0, 57) + "..." : s}`;
        })
        .join(", ");
    }
  }
}

export function ToolChainTimeline({ toolCalls }: ToolChainTimelineProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (toolCalls.length === 0) return null;

  return (
    <div className="space-y-1 ml-4">
      {toolCalls.map((tool, i) => {
        const isExpanded = expandedIndex === i;
        const hasDetail = tool.errorMessage || tool.toolInput;

        return (
          <div key={i}>
            <button
              onClick={() => hasDetail && setExpandedIndex(isExpanded ? null : i)}
              className={`w-full flex items-center gap-2 text-left px-2 py-1.5 rounded text-xs transition-colors ${
                hasDetail ? "hover:bg-accent/50 cursor-pointer" : "cursor-default"
              }`}
            >
              {tool.success === true && <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
              {tool.success === false && <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
              {tool.success === undefined && <span className="h-3.5 w-3.5 rounded-full bg-muted shrink-0" />}

              <span className="font-mono text-foreground">{tool.toolName}</span>

              {tool.duration != null && tool.duration > 0 && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 ml-auto">
                  {tool.duration >= 1000
                    ? (tool.duration / 1000).toFixed(1) + "s"
                    : tool.duration + "ms"}
                </Badge>
              )}

              {hasDetail && (
                isExpanded
                  ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
              )}
            </button>

            <AnimatePresence>
              {isExpanded && hasDetail && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="ml-6 mb-2 px-3 py-2 rounded bg-muted/50 border border-border text-xs">
                    {tool.toolInput && (
                      <p className="font-mono text-muted-foreground break-all">
                        {getToolInputSummary(tool.toolName, tool.toolInput)}
                      </p>
                    )}
                    {tool.errorMessage && (
                      <p className={`text-destructive ${tool.toolInput ? "mt-1" : ""}`}>
                        Error: {tool.errorMessage}
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
