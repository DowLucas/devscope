import { useEffect, useRef } from "react";
import { useAiStore } from "@/stores/aiStore";
import { ChatMessage } from "./ChatMessage";
import { Sparkles } from "lucide-react";

export function ChatMessageList() {
  const { messages, streamingContent, isStreaming } = useAiStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or streaming content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, streamingContent]);

  const isEmpty = messages.length === 0 && !isStreaming;

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
      {isEmpty && (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <Sparkles className="h-12 w-12 mb-4 opacity-30" />
          <h3 className="text-lg font-medium mb-1">DevScope AI</h3>
          <p className="text-sm text-center max-w-md">
            Ask questions about developer activity, project health, tool usage,
            and more. I'll query your data and provide insights.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-2 text-xs">
            {[
              "Who was most active this week?",
              "What's our tool failure rate?",
              "Compare last 7 days vs prior 7",
              "Which projects need attention?",
            ].map((q) => (
              <span
                key={q}
                className="rounded-md border border-border px-3 py-2 text-muted-foreground"
              >
                {q}
              </span>
            ))}
          </div>
        </div>
      )}

      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
      ))}

      {/* Streaming message */}
      {isStreaming && streamingContent && (
        <ChatMessage
          message={{
            id: "streaming",
            conversation_id: "",
            role: "assistant",
            content: streamingContent,
            tool_calls: null,
            tool_results: null,
            token_count: 0,
            model: null,
            created_at: new Date().toISOString(),
          }}
          isStreaming
        />
      )}

      {/* Loading indicator when streaming hasn't produced content yet */}
      {isStreaming && !streamingContent && (
        <div className="flex items-start gap-3">
          <div className="h-7 w-7 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
            <Sparkles className="h-3.5 w-3.5 text-accent-foreground" />
          </div>
          <div className="flex items-center gap-1 py-2">
            <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-pulse" />
            <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-pulse [animation-delay:150ms]" />
            <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-pulse [animation-delay:300ms]" />
          </div>
        </div>
      )}
    </div>
  );
}
