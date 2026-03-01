import { useCallback, useEffect } from "react";
import { useAiStore } from "@/stores/aiStore";
import { apiFetch } from "@/lib/api";

export function useAiInsights() {
  const {
    insights,
    insightsLoading,
    setInsights,
    setInsightsLoading,
  } = useAiStore();

  const fetchInsights = useCallback(
    async (opts?: { type?: string; severity?: string; limit?: number }) => {
      setInsightsLoading(true);
      try {
        const params = new URLSearchParams();
        if (opts?.type) params.set("type", opts.type);
        if (opts?.severity) params.set("severity", opts.severity);
        if (opts?.limit) params.set("limit", String(opts.limit));
        const qs = params.toString();
        const url = `/api/ai/insights${qs ? `?${qs}` : ""}`;
        const response = await apiFetch(url);
        if (!response.ok) return;
        const data = await response.json();
        if (Array.isArray(data)) setInsights(data);
      } catch {
        // ignore
      } finally {
        setInsightsLoading(false);
      }
    },
    [setInsights, setInsightsLoading]
  );

  const generateInsights = useCallback(
    async (days: number = 1) => {
      setInsightsLoading(true);
      try {
        const response = await apiFetch(
          `/api/ai/insights/generate?days=${days}`,
          { method: "POST" }
        );
        const newInsights = await response.json();
        // Prepend new insights
        setInsights([...newInsights, ...insights]);
      } catch {
        // ignore
      } finally {
        setInsightsLoading(false);
      }
    },
    [insights, setInsights, setInsightsLoading]
  );

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  return { insights, insightsLoading, fetchInsights, generateInsights };
}
