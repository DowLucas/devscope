import {
  AlertTriangle,
  TrendingUp,
  GitCompare,
  Lightbulb,
  AlertCircle,
  Info,
} from "lucide-react";
import { motion } from "motion/react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";
import type { AiInsight } from "@devscope/shared";

const TYPE_CONFIG = {
  anomaly: { icon: AlertTriangle, color: "text-amber-400" },
  trend: { icon: TrendingUp, color: "text-blue-400" },
  comparison: { icon: GitCompare, color: "text-purple-400" },
  recommendation: { icon: Lightbulb, color: "text-emerald-400" },
};

const SEVERITY_CONFIG = {
  critical: { icon: AlertCircle, variant: "destructive" as const, label: "Critical" },
  warning: { icon: AlertTriangle, variant: "outline" as const, label: "Warning" },
  info: { icon: Info, variant: "secondary" as const, label: "Info" },
};

interface AiInsightCardProps {
  insight: AiInsight;
}

export function AiInsightCard({ insight }: AiInsightCardProps) {
  const typeConfig = TYPE_CONFIG[insight.type];
  const severityConfig = SEVERITY_CONFIG[insight.severity];
  const TypeIcon = typeConfig.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="hover:bg-accent/5 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 ${typeConfig.color}`}>
              <TypeIcon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-medium text-sm truncate">
                  {insight.title}
                </h4>
                <Badge variant={severityConfig.variant} className="text-xs flex-shrink-0">
                  {severityConfig.label}
                </Badge>
                <Badge variant="outline" className="text-xs capitalize flex-shrink-0">
                  {insight.type}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {insight.narrative}
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span>{timeAgo(insight.created_at)}</span>
                <span className="capitalize">{insight.source}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
