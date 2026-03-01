import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { navigate } from "wouter/use-browser-location";
import { Badge } from "@/components/ui/badge";
import { ExportButton } from "@/components/ui/export-button";
import { parseUTC } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface SessionRow {
  id: string;
  developerName: string;
  projectName: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  eventCount: number;
  contextClearCount: number;
}

export function SessionTimeline() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/sessions?limit=50")
      .then((r) => r.json())
      .then((data) => {
        setSessions(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="text-muted-foreground text-center py-12 text-sm">
        Loading sessions...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">
          Session History
        </h2>
        <ExportButton dataType="sessions" />
      </div>
      {sessions.length === 0 ? (
        <div className="text-muted-foreground text-center py-12 text-sm">
          No sessions recorded yet.
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {sessions.map((session, i) => (
              <motion.div
                key={session.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => {
                  navigate(`/session/${session.id}`);
                }}
                className={
                  "border rounded-lg p-4 cursor-pointer transition-colors hover:bg-accent/30 " +
                  (session.status === "active"
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-border bg-card")
                }
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-foreground">
                      {session.developerName}
                    </span>
                    <span className="text-muted-foreground mx-2">in</span>
                    <span className="font-mono text-sm text-muted-foreground">
                      {session.projectName}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground">
                      {session.eventCount} events
                    </span>
                    {session.contextClearCount > 0 && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-400"
                      >
                        {session.contextClearCount} context clear{session.contextClearCount !== 1 ? "s" : ""}
                      </Badge>
                    )}
                    <Badge
                      variant={
                        session.status === "active" ? "default" : "secondary"
                      }
                      className={
                        session.status === "active" ? "bg-emerald-600" : ""
                      }
                    >
                      {session.status}
                    </Badge>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Started {parseUTC(session.startedAt).toLocaleString()}
                  {session.endedAt &&
                    " - Ended " + parseUTC(session.endedAt).toLocaleString()}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
