import { motion } from "motion/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useActivityStore } from "@/stores/activityStore";

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
        <h2 className="text-lg font-semibold mb-4 text-foreground">
          Developers
        </h2>
        <div className="text-muted-foreground text-center py-12 text-sm">
          No developers tracked yet.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4 text-foreground">Developers</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {developers.map((dev) => {
          const isActive = (dev.activeSessions ?? 0) > 0;
          return (
            <motion.div
              key={dev.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className={
                "border rounded-xl p-4 transition-colors " +
                (isActive
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-border bg-card")
              }
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="relative">
                  <Avatar>
                    <AvatarFallback>{getInitials(dev.name)}</AvatarFallback>
                  </Avatar>
                  {isActive && (
                    <motion.div
                      className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 border-2 border-background"
                      animate={{ scale: [1, 1.3, 1] }}
                      transition={{ repeat: Infinity, duration: 2 }}
                    />
                  )}
                </div>
                <div>
                  <div className="font-medium text-foreground">{dev.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {dev.email}
                  </div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {isActive ? (
                  <Badge variant="secondary" className="text-emerald-400">
                    {dev.activeSessions} active session
                    {(dev.activeSessions ?? 0) !== 1 ? "s" : ""}
                  </Badge>
                ) : (
                  <span>
                    Last seen:{" "}
                    {new Date(dev.lastSeen).toLocaleDateString()}
                  </span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
