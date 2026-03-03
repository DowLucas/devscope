import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { navigate } from "wouter/use-browser-location";
import { ArrowLeft, Clock, Loader2 } from "lucide-react";
import { useAiReports } from "@/hooks/useAiReports";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/utils";

interface AiReportViewerProps {
  reportId: string;
}

export function AiReportViewer({ reportId }: AiReportViewerProps) {
  const { selectedReport, fetchReport } = useAiReports();

  useEffect(() => {
    fetchReport(reportId);
  }, [reportId, fetchReport]);

  if (!selectedReport) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }

  if (selectedReport.status === "generating") {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <p className="text-sm">Generating report...</p>
        <p className="text-xs mt-1">This may take a minute.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            navigate("/dashboard/assistant/reports");
          }}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Reports
        </button>
      </div>

      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{selectedReport.title}</h2>
        <Badge variant="outline" className="capitalize">
          {selectedReport.report_type}
        </Badge>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {timeAgo(selectedReport.created_at)}
        </span>
        {selectedReport.content_markdown && (
          <span>
            {Math.ceil(
              selectedReport.content_markdown.split(/\s+/).length / 250
            )}{" "}
            min read
          </span>
        )}
      </div>

      <Card>
        <CardContent className="p-6">
          <ReportContent markdown={selectedReport.content_markdown} />
        </CardContent>
      </Card>
    </div>
  );
}

function ReportContent({ markdown }: { markdown: string }) {
  if (!markdown) {
    return <p className="text-muted-foreground text-sm">No content available.</p>;
  }

  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => <h2 className="font-bold text-lg mt-6 mb-3">{children}</h2>,
        h2: ({ children }) => <h3 className="font-semibold text-base mt-6 mb-2 border-b border-border pb-1">{children}</h3>,
        h3: ({ children }) => <h4 className="font-semibold mt-5 mb-2">{children}</h4>,
        h4: ({ children }) => <h5 className="font-semibold text-sm mt-4 mb-2">{children}</h5>,
        p: ({ children }) => <p className="text-sm my-1 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-6 my-1 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-6 my-1 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
        code: ({ className, children, ...props }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <pre className="bg-muted/50 rounded-md p-3 my-3 overflow-x-auto">
                <code className="text-xs font-mono">{children}</code>
              </pre>
            );
          }
          return (
            <code className="bg-muted/50 rounded px-1 py-0.5 text-xs font-mono" {...props}>
              {children}
            </code>
          );
        },
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        hr: () => <hr className="border-border my-4" />,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-border pl-3 italic text-muted-foreground my-2">
            {children}
          </blockquote>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
