import { Zap } from "lucide-react";
import { useActivityStore } from "@/stores/activityStore";

interface FrictionBadgeProps {
  sessionId?: string;
}

export function FrictionBadge({ sessionId }: FrictionBadgeProps) {
  const frictionAlerts = useActivityStore((s) => s.frictionAlerts);
  const relevant = sessionId
    ? frictionAlerts.filter((a) => a.session_id === sessionId && !a.acknowledged)
    : frictionAlerts.filter((a) => !a.acknowledged);

  if (relevant.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
      <Zap className="h-3 w-3 animate-pulse" />
      {relevant.length}
    </span>
  );
}
