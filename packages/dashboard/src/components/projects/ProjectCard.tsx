import { motion } from "motion/react";
import { FolderOpen, Users, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ProjectDetail } from "@devscope/shared";

interface ProjectCardProps {
  project: ProjectDetail;
  index: number;
  onClick: () => void;
}

export function ProjectCard({ project, index, onClick }: ProjectCardProps) {
  const healthColor =
    project.health_score >= 90
      ? "text-emerald-400"
      : project.health_score >= 70
        ? "text-yellow-400"
        : "text-destructive";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card
        className="cursor-pointer hover:border-accent transition-colors"
        onClick={onClick}
      >
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-medium truncate">{project.name}</span>
            </div>
            {project.active_sessions > 0 && (
              <Badge className="bg-emerald-600 text-[10px]">
                {project.active_sessions} active
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Activity className="h-3 w-3" />
              {project.total_events.toLocaleString()} events
            </div>
            <div className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {project.contributor_count} contributors
            </div>
            <div>{project.total_sessions} sessions</div>
            <div>{Math.round(project.total_minutes)}m total</div>
          </div>

          <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
            <span className={`text-sm font-semibold ${healthColor}`}>
              {project.health_score}%
            </span>
            {project.failure_rate > 0 && (
              <span className="text-[10px] text-destructive">
                {(project.failure_rate * 100).toFixed(1)}% fail rate
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
