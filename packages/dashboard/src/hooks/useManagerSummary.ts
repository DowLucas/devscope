import { useEffect, useState } from "react";
import type { ManagerSummary } from "@devscope/shared";
import { apiFetch } from "@/lib/api";

export function useManagerSummary(days = 7) {
  const [data, setData] = useState<ManagerSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiFetch(`/api/reports/manager-summary?days=${days}`)
      .then((r) => r.json())
      .then((d) => {
        if (active) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [days]);

  return { data, loading };
}
