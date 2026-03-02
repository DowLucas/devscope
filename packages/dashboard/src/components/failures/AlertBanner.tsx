import { motion, AnimatePresence } from "motion/react";
import { navigate } from "wouter/use-browser-location";
import { AlertTriangle, X } from "lucide-react";
import { useActivityStore } from "@/stores/activityStore";
import { apiFetch } from "@/lib/api";

export function AlertBanner() {
  const alerts = useActivityStore((s) => s.alerts);
  const acknowledgeAlert = useActivityStore((s) => s.acknowledgeAlert);

  const unacknowledged = alerts.filter((a) => !a.acknowledged);
  if (unacknowledged.length === 0) return null;

  return (
    <AnimatePresence>
      {unacknowledged.slice(0, 3).map((alert) => (
        <motion.div
          key={alert.id}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden"
        >
          <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-2 flex items-center gap-3 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1">
              Alert: <span className="font-medium">{alert.tool_name}</span> failed{" "}
              {alert.failure_count} times in session{" "}
              <button
                onClick={() => {
                  navigate(`/dashboard/sessions/${alert.session_id}`);
                }}
                className="underline hover:no-underline"
              >
                {alert.session_id.slice(0, 8)}
              </button>
            </span>
            <button
              onClick={() => {
                acknowledgeAlert(alert.id);
                apiFetch(`/api/alerts/${alert.id}/acknowledge`, { method: "POST" });
              }}
              className="hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
