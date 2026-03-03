import { User, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { AiMessage } from "@devscope/shared";

interface ChatMessageProps {
  message: AiMessage;
  isStreaming?: boolean;
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex items-start gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser ? "bg-primary" : "bg-accent"
        }`}
      >
        {isUser ? (
          <User className="h-3.5 w-3.5 text-primary-foreground" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 text-accent-foreground" />
        )}
      </div>

      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted/50"
        }`}
      >
        <div className="prose prose-sm prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <MessageContent content={message.content} />
        </div>
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 ml-0.5 bg-foreground/70 animate-pulse" />
        )}
      </div>
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  if (!content) return null;

  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => <h2 className="text-lg font-bold mt-4 mb-2">{children}</h2>,
        h2: ({ children }) => <h3 className="text-base font-semibold mt-3 mb-1">{children}</h3>,
        h3: ({ children }) => <h4 className="text-sm font-semibold mt-2 mb-1">{children}</h4>,
        p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        code: ({ className, children, ...props }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <pre className="bg-zinc-900 rounded-lg p-3 my-2 overflow-x-auto">
                <code className="text-sm text-zinc-100 font-mono">{children}</code>
              </pre>
            );
          }
          return (
            <code className="bg-zinc-800/50 text-zinc-200 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
              {children}
            </code>
          );
        },
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-zinc-600 pl-3 italic text-zinc-400 my-2">
            {children}
          </blockquote>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
