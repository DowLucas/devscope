import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ToolSequenceVizProps {
  tools: string[];
}

export function ToolSequenceViz({ tools }: ToolSequenceVizProps) {
  if (!tools || tools.length === 0) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {tools.map((tool, i) => (
        <div key={`${tool}-${i}`} className="flex items-center gap-1">
          <Badge variant="outline" className="text-xs font-mono">
            {tool}
          </Badge>
          {i < tools.length - 1 && (
            <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}
