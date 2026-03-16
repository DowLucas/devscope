import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Sparkles, Loader2, RefreshCw, Lock, Eye, EyeOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import type { AiReport } from "@devscope/shared";

interface SessionFeedbackPanelProps {
  sessionId: string;
  privacyMode: string | null;
  isSelfView: boolean;
}

function PrivacyBadge({ privacyMode, isSelfView }: { privacyMode: string | null; isSelfView: boolean }) {
  const isOpen = privacyMode === "open" && isSelfView;
  const isPrivate = privacyMode === "private";

  if (isPrivate) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Lock className="h-3 w-3" />
        Private mode
      </span>
    );
  }

  if (isOpen) {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <Eye className="h-3 w-3" />
        Full debrief — includes your prompts &amp; responses
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <EyeOff className="h-3 w-3" />
      Metadata debrief — set <code className="font-mono">DEVSCOPE_PRIVACY=open</code> for richer insights
    </span>
  );
}

function DebriefContent({ markdown }: { markdown: string }) {
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
          <blockquote className="border-l-2 border-primary/40 pl-3 text-muted-foreground my-2 text-sm">
            {children}
          </blockquote>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}

export function SessionFeedbackPanel({ sessionId, privacyMode, isSelfView }: SessionFeedbackPanelProps) {
  const [report, setReport] = useState<AiReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPrivate = privacyMode === "private";

  async function generateDebrief() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/ai/session-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Failed to generate debrief.");
        return;
      }

      const data: AiReport = await res.json();
      setReport(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Session Debrief</span>
          <Badge variant="outline" className="text-xs">AI</Badge>
        </div>
        <PrivacyBadge privacyMode={privacyMode} isSelfView={isSelfView} />
      </div>

      {!report && !loading && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs text-muted-foreground">
            Get AI-powered feedback on this session: what went well, where Claude Code struggled,
            and concrete suggestions for improving your CLAUDE.md and skills.
          </p>
          <button
            onClick={generateDebrief}
            disabled={isPrivate}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {isPrivate ? "Unavailable in private mode" : "Get Debrief"}
          </button>
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Analysing your session…
        </div>
      )}

      {report && (
        <Card>
          <CardContent className="p-4">
            <DebriefContent markdown={report.content_markdown ?? ""} />
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => { setReport(null); setError(null); }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Regenerate
              </button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
