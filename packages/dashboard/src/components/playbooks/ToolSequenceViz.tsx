import { ChevronRight } from "lucide-react";

interface ToolSequenceVizProps {
  tools: string[];
  compact?: boolean;
}

export function ToolSequenceViz({ tools, compact }: ToolSequenceVizProps) {
  const size = compact ? "text-xs" : "text-sm";
  const displayTools = compact ? tools.slice(0, 5) : tools;
  const hasMore = compact && tools.length > 5;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {displayTools.map((tool, i) => (
        <span key={i} className="flex items-center gap-1">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-md bg-primary/10 text-primary font-mono ${size}`}
          >
            {tool}
          </span>
          {i < displayTools.length - 1 && (
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
          )}
        </span>
      ))}
      {hasMore && (
        <span className={`text-muted-foreground ${size}`}>
          +{tools.length - 5} more
        </span>
      )}
    </div>
  );
}
