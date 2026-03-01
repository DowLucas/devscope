import { motion } from "motion/react";
import type { DeveloperHealthEntry } from "@devscope/shared";
import { Card, CardContent } from "@/components/ui/card";

interface DeveloperHeatmapProps {
  developers: DeveloperHealthEntry[];
}

const STATUS_COLORS = {
  active: "bg-emerald-400",
  idle: "bg-yellow-400",
  offline: "bg-muted-foreground/50",
};

export function DeveloperHeatmap({ developers }: DeveloperHeatmapProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {developers.map((dev, i) => {
        const maxActivity = Math.max(...dev.hourly_activity, 1);
        return (
          <motion.div
            key={dev.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS_COLORS[dev.status]} ${
                    dev.status === "active" ? "animate-pulse" : ""
                  }`} />
                  <span className="text-sm font-medium truncate">{dev.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto capitalize">{dev.status}</span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground mb-2">
                  <div>{dev.today_sessions} sessions</div>
                  <div>{dev.today_prompts} prompts</div>
                  <div>{dev.today_tool_calls} tools</div>
                </div>

                <div className="flex gap-px h-6">
                  {dev.hourly_activity.map((count, hour) => (
                    <div
                      key={hour}
                      className="flex-1 rounded-sm"
                      style={{
                        backgroundColor: count > 0
                          ? `oklch(0.696 0.17 162.48 / ${Math.max(0.15, count / maxActivity)})`
                          : "oklch(1 0 0 / 5%)",
                      }}
                      title={`${hour}:00 — ${count} events`}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
