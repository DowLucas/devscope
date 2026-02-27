import { motion } from "motion/react";
import { useActivityStore } from "../stores/activityStore";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function DeveloperCards() {
  const developers = useActivityStore((s) => s.developers);

  if (developers.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">Developers</h2>
        <div className="text-gray-500 text-center py-12">No developers tracked yet.</div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Developers</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {developers.map((dev) => {
          const isActive = (dev.active_sessions ?? 0) > 0;
          return (
            <motion.div
              key={dev.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className={"border rounded-xl p-4 transition-colors " +
                (isActive
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-gray-800 bg-gray-900/50"
                )
              }
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="relative">
                  <div className="h-10 w-10 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold">
                    {getInitials(dev.name)}
                  </div>
                  {isActive && (
                    <motion.div
                      className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 border-2 border-gray-950"
                      animate={{ scale: [1, 1.3, 1] }}
                      transition={{ repeat: Infinity, duration: 2 }}
                    />
                  )}
                </div>
                <div>
                  <div className="font-medium">{dev.name}</div>
                  <div className="text-xs text-gray-500">{dev.email}</div>
                </div>
              </div>
              <div className="text-xs text-gray-500">
                {isActive ? (
                  <span className="text-emerald-400">
                    {dev.active_sessions} active session{(dev.active_sessions ?? 0) !== 1 ? "s" : ""}
                  </span>
                ) : (
                  <span>Last seen: {new Date(dev.lastSeen ?? (dev as any).last_seen).toLocaleDateString()}</span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
