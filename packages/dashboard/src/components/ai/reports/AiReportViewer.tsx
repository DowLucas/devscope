import { useEffect, type ReactNode } from "react";
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
            navigate("/ai/reports");
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

  const lines = markdown.split("\n");
  const elements: ReactNode[] = [];
  let inCodeBlock = false;
  let codeContent = "";
  let key = 0;

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={key++} className="bg-muted/50 rounded-md p-3 text-xs overflow-x-auto my-3">
            <code>{codeContent}</code>
          </pre>
        );
        codeContent = "";
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      codeContent += (codeContent ? "\n" : "") + line;
      continue;
    }

    if (line.startsWith("#### ")) {
      elements.push(<h5 key={key++} className="font-semibold text-sm mt-4 mb-2">{line.slice(5)}</h5>);
    } else if (line.startsWith("### ")) {
      elements.push(<h4 key={key++} className="font-semibold mt-5 mb-2">{line.slice(4)}</h4>);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={key++} className="font-semibold text-base mt-6 mb-2 border-b border-border pb-1">{line.slice(3)}</h3>);
    } else if (line.startsWith("# ")) {
      elements.push(<h2 key={key++} className="font-bold text-lg mt-6 mb-3">{line.slice(2)}</h2>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={key++} className="flex gap-2 ml-4 my-0.5">
          <span className="text-muted-foreground mt-0.5">•</span>
          <span className="text-sm"><InlineFormat text={line.slice(2)} /></span>
        </div>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+)\.\s(.+)/);
      if (match) {
        elements.push(
          <div key={key++} className="flex gap-2 ml-4 my-0.5">
            <span className="text-muted-foreground font-mono text-xs mt-0.5">{match[1]}.</span>
            <span className="text-sm"><InlineFormat text={match[2]} /></span>
          </div>
        );
      }
    } else if (line.startsWith("---")) {
      elements.push(<hr key={key++} className="border-border my-4" />);
    } else if (line.trim() === "") {
      elements.push(<div key={key++} className="h-2" />);
    } else {
      elements.push(<p key={key++} className="text-sm my-1 leading-relaxed"><InlineFormat text={line} /></p>);
    }
  }

  return <div className="space-y-0">{elements}</div>;
}

function InlineFormat({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        const codeParts = part.split(/(`[^`]+`)/g);
        return codeParts.map((cp, j) => {
          if (cp.startsWith("`") && cp.endsWith("`")) {
            return (
              <code key={`${i}-${j}`} className="bg-muted/50 rounded px-1 py-0.5 text-xs">
                {cp.slice(1, -1)}
              </code>
            );
          }
          return <span key={`${i}-${j}`}>{cp}</span>;
        });
      })}
    </>
  );
}
