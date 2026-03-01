import { useEffect } from "react";
import { Plus, History } from "lucide-react";
import { useAiStore } from "@/stores/aiStore";
import { useAiChat } from "@/hooks/useAiChat";
import { apiFetch } from "@/lib/api";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";
import { timeAgo } from "@/lib/utils";

export function ChatPanel() {
  const { conversations, activeConversationId } = useAiStore();
  const { setConversations } = useAiStore();
  const { loadConversation, startNewConversation } = useAiChat();

  useEffect(() => {
    apiFetch("/api/ai/chat/conversations")
      .then((r) => {
        if (!r.ok) return [];
        return r.json();
      })
      .then((data) => {
        if (Array.isArray(data)) setConversations(data);
      })
      .catch(() => {});
  }, [setConversations]);

  return (
    <div className="flex gap-4 h-[calc(100vh-12rem)]">
      {/* Sidebar: conversation list */}
      <div className="w-56 flex-shrink-0 border border-border rounded-lg overflow-hidden flex flex-col">
        <div className="p-3 border-b border-border">
          <button
            onClick={startNewConversation}
            className="w-full flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/80 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <History className="h-8 w-8 mb-2 opacity-50" />
              <span className="text-xs">No conversations yet</span>
            </div>
          )}
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => loadConversation(conv.id)}
              className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                activeConversationId === conv.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              <div className="truncate font-medium">{conv.title}</div>
              <div className="text-xs opacity-70">
                {timeAgo(conv.updated_at)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col border border-border rounded-lg overflow-hidden">
        <ChatMessageList />
        <ChatInput />
      </div>
    </div>
  );
}
