import type { ReactNode } from "react";
import { User, Sparkles } from "lucide-react";
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

  // Simple markdown-like rendering for common patterns
  const lines = content.split("\n");
  const elements: ReactNode[] = [];
  let inCodeBlock = false;
  let codeContent = "";
  let key = 0;

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={key++} className="bg-background/50 rounded p-2 text-xs overflow-x-auto my-2">
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

    if (line.startsWith("### ")) {
      elements.push(<h4 key={key++} className="font-semibold mt-3 mb-1">{line.slice(4)}</h4>);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={key++} className="font-semibold text-base mt-3 mb-1">{line.slice(3)}</h3>);
    } else if (line.startsWith("# ")) {
      elements.push(<h2 key={key++} className="font-bold text-lg mt-3 mb-1">{line.slice(2)}</h2>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={key++} className="flex gap-2 ml-2">
          <span className="text-muted-foreground">•</span>
          <span><InlineFormat text={line.slice(2)} /></span>
        </div>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+)\.\s(.+)/);
      if (match) {
        elements.push(
          <div key={key++} className="flex gap-2 ml-2">
            <span className="text-muted-foreground">{match[1]}.</span>
            <span><InlineFormat text={match[2]} /></span>
          </div>
        );
      }
    } else if (line.trim() === "") {
      elements.push(<div key={key++} className="h-2" />);
    } else {
      elements.push(<p key={key++} className="my-1"><InlineFormat text={line} /></p>);
    }
  }

  if (inCodeBlock && codeContent) {
    elements.push(
      <pre key={key++} className="bg-background/50 rounded p-2 text-xs overflow-x-auto my-2">
        <code>{codeContent}</code>
      </pre>
    );
  }

  return <>{elements}</>;
}

function InlineFormat({ text }: { text: string }) {
  // Bold: **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        // Inline code: `text`
        const codeParts = part.split(/(`[^`]+`)/g);
        return codeParts.map((cp, j) => {
          if (cp.startsWith("`") && cp.endsWith("`")) {
            return (
              <code key={`${i}-${j}`} className="bg-background/50 rounded px-1 py-0.5 text-xs">
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
