import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

interface SessionRow {
  id: string;
  developer_name: string;
  project_name: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  event_count: number;
}

export function SessionTimeline() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/sessions?limit=50")
      .then((r) => r.json())
      .then((data) => {
        setSessions(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-gray-500 text-center py-12">Loading sessions...</div>;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Session History</h2>
      {sessions.length === 0 ? (
        <div className="text-gray-500 text-center py-12">No sessions recorded yet.</div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {sessions.map((session, i) => (
              <motion.div
                key={session.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={"border rounded-lg p-4 " +
                  (session.status === "active"
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-gray-800 bg-gray-900/50"
                  )
                }
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{session.developer_name}</span>
                    <span className="text-gray-500 mx-2">in</span>
                    <span className="font-mono text-sm text-gray-300">{session.project_name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-500">{session.event_count} events</span>
                    <span
                      className={"px-2 py-0.5 rounded-full text-xs " +
                        (session.status === "active"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-gray-800 text-gray-400"
                        )
                      }
                    >
                      {session.status}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  Started {new Date(session.started_at).toLocaleString()}
                  {session.ended_at && (" - Ended " + new Date(session.ended_at).toLocaleString())}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
