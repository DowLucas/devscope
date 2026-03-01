import { useState, useCallback, type KeyboardEvent } from "react";
import { Send, Square } from "lucide-react";
import { useAiStore } from "@/stores/aiStore";
import { useAiChat } from "@/hooks/useAiChat";

export function ChatInput() {
  const [input, setInput] = useState("");
  const { isStreaming } = useAiStore();
  const { sendMessage, cancelStream } = useAiChat();

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    sendMessage(trimmed);
  }, [input, isStreaming, sendMessage]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about developer activity, project health, tool usage..."
          disabled={isStreaming}
          rows={1}
          className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          style={{ minHeight: "2.5rem", maxHeight: "8rem" }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "auto";
            target.style.height = Math.min(target.scrollHeight, 128) + "px";
          }}
        />
        {isStreaming ? (
          <button
            onClick={cancelStream}
            className="flex items-center justify-center h-9 w-9 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="flex items-center justify-center h-9 w-9 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
