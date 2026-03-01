import { create } from "zustand";
import type { AiConversation, AiMessage, AiInsight, AiReport } from "@devscope/shared";

interface AiState {
  // Chat
  conversations: AiConversation[];
  activeConversationId: string | null;
  messages: AiMessage[];
  streamingContent: string;
  isStreaming: boolean;

  // Insights
  insights: AiInsight[];
  insightsLoading: boolean;

  // Reports
  reports: AiReport[];
  reportsLoading: boolean;
  generatingReport: boolean;

  // Actions
  setConversations: (conversations: AiConversation[]) => void;
  setActiveConversationId: (id: string | null) => void;
  setMessages: (messages: AiMessage[]) => void;
  appendStreamingContent: (content: string) => void;
  clearStreamingContent: () => void;
  setIsStreaming: (streaming: boolean) => void;
  addMessage: (message: AiMessage) => void;

  setInsights: (insights: AiInsight[]) => void;
  addInsight: (insight: AiInsight) => void;
  setInsightsLoading: (loading: boolean) => void;

  setReports: (reports: AiReport[]) => void;
  addReport: (report: AiReport) => void;
  setReportsLoading: (loading: boolean) => void;
  setGeneratingReport: (generating: boolean) => void;
}

export const useAiStore = create<AiState>((set) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  streamingContent: "",
  isStreaming: false,

  insights: [],
  insightsLoading: false,

  reports: [],
  reportsLoading: false,
  generatingReport: false,

  setConversations: (conversations) => set({ conversations }),
  setActiveConversationId: (activeConversationId) =>
    set({ activeConversationId }),
  setMessages: (messages) => set({ messages }),
  appendStreamingContent: (content) =>
    set((state) => ({
      streamingContent: state.streamingContent + content,
    })),
  clearStreamingContent: () => set({ streamingContent: "" }),
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),

  setInsights: (insights) => set({ insights }),
  addInsight: (insight) =>
    set((state) => ({
      insights: [insight, ...state.insights],
    })),
  setInsightsLoading: (insightsLoading) => set({ insightsLoading }),

  setReports: (reports) => set({ reports }),
  addReport: (report) =>
    set((state) => ({
      reports: [report, ...state.reports],
    })),
  setReportsLoading: (reportsLoading) => set({ reportsLoading }),
  setGeneratingReport: (generatingReport) => set({ generatingReport }),
}));

// Preserve store state across Vite HMR
if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    const state = useAiStore.getState();
    data.state = Object.fromEntries(
      Object.entries(state).filter(([, v]) => typeof v !== "function")
    );
  });
  if (import.meta.hot.data.state) {
    useAiStore.setState(import.meta.hot.data.state);
  }
}
