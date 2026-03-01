import { useCallback, useRef } from "react";
import { useAiStore } from "@/stores/aiStore";
import { apiFetch } from "@/lib/api";

export function useAiChat() {
  const abortRef = useRef<AbortController | null>(null);
  const {
    activeConversationId,
    isStreaming,
    setActiveConversationId,
    setMessages,
    addMessage,
    appendStreamingContent,
    clearStreamingContent,
    setIsStreaming,
    setConversations,
  } = useAiStore();

  const sendMessage = useCallback(
    async (question: string) => {
      if (isStreaming) return;

      // Add optimistic user message
      const userMsg = {
        id: crypto.randomUUID(),
        conversation_id: activeConversationId ?? "",
        role: "user" as const,
        content: question,
        tool_calls: null,
        tool_results: null,
        token_count: 0,
        model: null,
        created_at: new Date().toISOString(),
      };
      addMessage(userMsg);

      setIsStreaming(true);
      clearStreamingContent();

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const response = await apiFetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            conversation_id: activeConversationId ?? undefined,
          }),
          signal: abort.signal,
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: "Request failed" }));
          throw new Error(error.error ?? `HTTP ${response.status}`);
        }

        // Get conversation ID from header
        const convId = response.headers.get("X-Conversation-Id");
        if (convId && !activeConversationId) {
          setActiveConversationId(convId);
        }

        // Read SSE stream
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") continue;

            try {
              const data = JSON.parse(payload);
              if (data.type === "text") {
                appendStreamingContent(data.content);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }

        // Finalize: add assistant message from accumulated content
        const finalContent = useAiStore.getState().streamingContent;
        const assistantMsg = {
          id: crypto.randomUUID(),
          conversation_id: convId ?? activeConversationId ?? "",
          role: "assistant" as const,
          content: finalContent,
          tool_calls: null,
          tool_results: null,
          token_count: 0,
          model: "gemini-2.0-flash",
          created_at: new Date().toISOString(),
        };
        addMessage(assistantMsg);
        clearStreamingContent();

        // Refresh conversations list
        apiFetch("/api/ai/chat/conversations")
          .then((r) => (r.ok ? r.json() : []))
          .then((data) => {
            if (Array.isArray(data)) setConversations(data);
          })
          .catch(() => {});
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          const errorMsg = {
            id: crypto.randomUUID(),
            conversation_id: activeConversationId ?? "",
            role: "assistant" as const,
            content: `Error: ${(err as Error).message}`,
            tool_calls: null,
            tool_results: null,
            token_count: 0,
            model: null,
            created_at: new Date().toISOString(),
          };
          addMessage(errorMsg);
          clearStreamingContent();
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [
      activeConversationId,
      isStreaming,
      setActiveConversationId,
      setMessages,
      addMessage,
      appendStreamingContent,
      clearStreamingContent,
      setIsStreaming,
      setConversations,
    ]
  );

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    clearStreamingContent();
  }, [setIsStreaming, clearStreamingContent]);

  const loadConversation = useCallback(
    async (conversationId: string) => {
      setActiveConversationId(conversationId);
      try {
        const response = await apiFetch(
          `/api/ai/chat/conversations/${conversationId}`
        );
        const messages = await response.json();
        setMessages(messages);
      } catch {
        setMessages([]);
      }
    },
    [setActiveConversationId, setMessages]
  );

  const startNewConversation = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    clearStreamingContent();
  }, [setActiveConversationId, setMessages, clearStreamingContent]);

  return {
    sendMessage,
    cancelStream,
    loadConversation,
    startNewConversation,
  };
}
