import { useState } from "react";
import { navigate } from "wouter/use-browser-location";
import { Plus, FileText, Loader2 } from "lucide-react";
import { useAiReports } from "@/hooks/useAiReports";
import { AiReportCard } from "./AiReportCard";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReportType } from "@devscope/shared";

export function AiReportsList() {
  const { reports, reportsLoading, generatingReport, generateReport } =
    useAiReports();
  const [showTypeMenu, setShowTypeMenu] = useState(false);

  const handleGenerate = async (type: ReportType) => {
    setShowTypeMenu(false);
    const report = await generateReport(type);
    if (report) {
      navigate(`/ai/reports/${report.id}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          AI-generated executive reports with metrics and recommendations.
        </p>
        <div className="relative">
          <button
            onClick={() => setShowTypeMenu(!showTypeMenu)}
            disabled={generatingReport}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {generatingReport ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Generate Report
          </button>
          {showTypeMenu && (
            <div className="absolute right-0 top-full mt-1 w-40 rounded-md border border-border bg-popover p-1 shadow-md z-10">
              {(["daily", "weekly", "custom"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => handleGenerate(type)}
                  className="w-full text-left rounded-sm px-3 py-1.5 text-sm capitalize hover:bg-accent transition-colors"
                >
                  {type} Report
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {reportsLoading && reports.length === 0 && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!reportsLoading && reports.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <FileText className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-sm">No reports generated yet.</p>
          <p className="text-xs mt-1">
            Click "Generate Report" to create an executive summary.
          </p>
        </div>
      )}

      <div className="grid gap-3">
        {reports.map((report) => (
          <AiReportCard key={report.id} report={report} />
        ))}
      </div>
    </div>
  );
}
