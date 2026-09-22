import { Card } from "@/components/ui/card";
import type { DimensionView } from "./dimensions";

interface Props {
  dimensions: DimensionView[];
  sessionsAnalyzed: number;
}

function getDescriptor(dim: DimensionView): string {
  if (dim.value == null) return "Unknown";
  return dim.value > 0.6 ? dim.descriptors[1] : dim.value < 0.4 ? dim.descriptors[0] : "Balanced";
}

export function WorkflowProfileCard({ dimensions, sessionsAnalyzed }: Props) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">Profile Summary</h3>
        <span className="text-xs text-muted-foreground">
          {sessionsAnalyzed} sessions analyzed
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {dimensions.map((dim) => (
          <div key={dim.key} className="space-y-1" title={dim.hint}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{dim.label}</span>
              <span className="text-xs font-medium">
                {dim.value != null ? `${Math.round(dim.value * 100)}%` : "—"}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${(dim.value ?? 0) * 100}%` }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground">{getDescriptor(dim)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
