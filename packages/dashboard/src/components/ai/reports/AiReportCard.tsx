import { FileText, Clock, CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { navigate } from "wouter/use-browser-location";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";
import type { AiReport } from "@devscope/shared";

const STATUS_CONFIG = {
  generating: { icon: Loader2, variant: "outline" as const, className: "animate-spin" },
  completed: { icon: CheckCircle, variant: "secondary" as const, className: "" },
  failed: { icon: AlertCircle, variant: "destructive" as const, className: "" },
};

interface AiReportCardProps {
  report: AiReport;
}

export function AiReportCard({ report }: AiReportCardProps) {
  const statusConfig = STATUS_CONFIG[report.status];
  const StatusIcon = statusConfig.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Card
        className="hover:bg-accent/5 transition-colors cursor-pointer"
        onClick={() => {
          if (report.status === "completed") {
            navigate(`/ai/reports/${report.id}`);
          }
        }}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="text-muted-foreground mt-0.5">
              <FileText className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-medium text-sm truncate">{report.title}</h4>
                <Badge variant={statusConfig.variant} className="text-xs flex-shrink-0 capitalize">
                  <StatusIcon className={`h-3 w-3 mr-1 ${statusConfig.className}`} />
                  {report.status}
                </Badge>
                <Badge variant="outline" className="text-xs capitalize flex-shrink-0">
                  {report.report_type}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {timeAgo(report.created_at)}
                </span>
                {report.content_markdown && (
                  <span>
                    {Math.ceil(report.content_markdown.split(/\s+/).length / 250)} min
                    read
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
