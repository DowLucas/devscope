import { Zap, Check } from "lucide-react";
import { useActivityStore } from "@/stores/activityStore";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

const SEVERITY_CLASSES: Record<string, string> = {
  info: "bg-blue-500/15 text-blue-400",
  warning: "bg-amber-500/15 text-amber-400",
  critical: "bg-destructive/15 text-destructive",
};

export function FrictionFeed() {
  const frictionAlerts = useActivityStore((s) => s.frictionAlerts);
  const acknowledgeFrictionAlert = useActivityStore((s) => s.acknowledgeFrictionAlert);

  async function handleAcknowledge(alertId: string) {
    try {
      await apiFetch(`/api/friction/${alertId}/acknowledge`, { method: "POST" });
      acknowledgeFrictionAlert(alertId);
    } catch {
      // Ignore
    }
  }

  if (frictionAlerts.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No friction alerts detected yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {frictionAlerts.map((alert) => (
        <Card key={alert.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Zap className={`h-4 w-4 mt-0.5 ${alert.severity === "critical" ? "text-destructive" : "text-amber-400"}`} />
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_CLASSES[alert.severity] ?? SEVERITY_CLASSES.info}`}>
                    {alert.severity}
                  </span>
                  <span className="text-sm font-medium">{alert.title}</span>
                </div>
                <p className="text-sm text-muted-foreground">{alert.description}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(alert.triggered_at).toLocaleTimeString()}
                </p>
              </div>
            </div>
            {!alert.acknowledged && (
              <button
                onClick={() => handleAcknowledge(alert.id)}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Acknowledge"
              >
                <Check className="h-4 w-4" />
              </button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
