import { useCallback, useEffect, useState } from "react";
import { useAiStore } from "@/stores/aiStore";
import { apiFetch } from "@/lib/api";
import type { AiReport, ReportType } from "@devscope/shared";

export function useAiReports() {
  const {
    reports,
    reportsLoading,
    generatingReport,
    setReports,
    setReportsLoading,
    setGeneratingReport,
    addReport,
  } = useAiStore();

  const fetchReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      const response = await apiFetch("/api/ai/reports");
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data)) setReports(data);
    } catch {
      // ignore
    } finally {
      setReportsLoading(false);
    }
  }, [setReports, setReportsLoading]);

  const generateReport = useCallback(
    async (reportType: ReportType, title?: string) => {
      setGeneratingReport(true);
      try {
        const response = await apiFetch("/api/ai/reports/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ report_type: reportType, title }),
        });
        const report = await response.json();
        addReport(report);
        return report as AiReport;
      } finally {
        setGeneratingReport(false);
      }
    },
    [setGeneratingReport, addReport]
  );

  const [selectedReport, setSelectedReport] = useState<AiReport | null>(null);

  const fetchReport = useCallback(async (id: string) => {
    try {
      const response = await apiFetch(`/api/ai/reports/${id}`);
      const report = await response.json();
      setSelectedReport(report);
      return report as AiReport;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  return {
    reports,
    reportsLoading,
    generatingReport,
    selectedReport,
    fetchReports,
    generateReport,
    fetchReport,
    setSelectedReport,
  };
}
